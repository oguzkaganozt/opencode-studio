import {
  createOpencodeClient,
  type Message,
  type OpencodeClient,
  type Part,
  type PermissionRequest,
  type Session,
  type SessionStatus,
  type SnapshotFileDiff,
} from "@opencode-ai/sdk/v2/client"
import { type StudioSessionContext, type StudioSessionHistoryResponse, studioSessionMetadata } from "../../src/core/session-history"
import { fetchJson } from "../lib/fetch-json"

export type AgentMessage = {
  info: Message
  parts: Part[]
}

export type AgentHealth = {
  ok: boolean
  version?: string
  error?: string
}

function originBase(): string {
  if (typeof window === "undefined") return "http://127.0.0.1"
  return window.location.origin
}

export function createAgentClient(directory?: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl: originBase(),
    directory: directory?.trim() || undefined,
  })
}

export async function probeAgentHealth(): Promise<AgentHealth> {
  try {
    const response = await fetch(`${originBase()}/global/health`, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const data = (await response.json().catch(() => null)) as { healthy?: unknown; version?: unknown } | null
    if (data?.healthy !== true || typeof data.version !== "string") {
      return { ok: false, error: "Invalid OpenCode health response" }
    }
    return { ok: true, version: data.version }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function listSessionHistory(input: {
  scope: "studio" | "directory"
  directory?: string
  contextKey?: string
  search?: string
}): Promise<StudioSessionHistoryResponse> {
  const params = new URLSearchParams({ scope: input.scope })
  if (input.directory) params.set("directory", input.directory)
  if (input.contextKey) params.set("contextKey", input.contextKey)
  if (input.search) params.set("search", input.search)
  return fetchJson<StudioSessionHistoryResponse>(`/api/agent/history?${params}`)
}

async function sdk<T>(directory: string | undefined, run: (client: OpencodeClient) => Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const client = createAgentClient(directory)
  const result = await run(client)
  if (result.error) throw new Error(formatSdkError(result.error))
  return result.data as T
}

export async function createSession(directory: string, context: StudioSessionContext, title?: string): Promise<Session> {
  const data = await sdk(directory, (client) => client.session.create({ directory, title, metadata: studioSessionMetadata(context) }))
  if (!data) throw new Error("create session failed")
  return data
}

export async function listMessages(sessionID: string, directory?: string): Promise<AgentMessage[]> {
  return (await sdk(directory, (client) => client.session.messages({ sessionID, directory }))) ?? ([] as AgentMessage[])
}

export async function promptSessionAsync(input: {
  sessionID: string
  text: string
  directory?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}): Promise<void> {
  await sdk(input.directory, (client) =>
    client.session.promptAsync({
      sessionID: input.sessionID,
      directory: input.directory,
      agent: "build",
      model: input.model ? { providerID: input.model.providerID, modelID: input.model.modelID } : undefined,
      variant: input.variant,
      parts: [{ type: "text", text: input.text }],
    }),
  )
}

export async function abortSession(sessionID: string, directory?: string): Promise<void> {
  await sdk(directory, (client) => client.session.abort({ sessionID, directory }))
}

export async function replyPermission(input: {
  requestID: string
  reply: "once" | "always" | "reject"
  directory?: string
}): Promise<void> {
  await sdk(input.directory, (client) =>
    client.permission.reply({ requestID: input.requestID, directory: input.directory, reply: input.reply }),
  )
}

export async function sessionDiff(sessionID: string, directory?: string): Promise<SnapshotFileDiff[]> {
  return (await sdk(directory, (client) => client.session.diff({ sessionID, directory }))) ?? []
}

export async function listProviders(directory?: string) {
  return sdk(directory, (client) => client.config.providers(directory ? { directory } : undefined))
}

export async function listSessionStatuses(directory?: string): Promise<Record<string, SessionStatus>> {
  return (await sdk(directory, (client) => client.session.status(directory ? { directory } : undefined))) ?? {}
}

export async function listPendingPermissions(directory?: string): Promise<PermissionRequest[]> {
  return (await sdk(directory, (client) => client.permission.list(directory ? { directory } : undefined))) ?? []
}

export type EventHandler = (event: { type: string; properties?: unknown }) => void

/**
 * Subscribe to OpenCode SSE `/event` with auto-reconnect.
 * Transient disconnects do NOT surface as fatal — only explicit onError callback.
 */
export function subscribeAgentEvents(
  directory: string | undefined,
  onEvent: EventHandler,
  options?: { onConnectionChange?: (state: "open" | "retry" | "closed") => void },
): () => void {
  const params = new URLSearchParams()
  if (directory?.trim()) params.set("directory", directory.trim())
  const url = `${originBase()}/event${params.size ? `?${params}` : ""}`
  let closed = false
  let ac: AbortController | undefined
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const connect = () => {
    if (closed) return
    ac = new AbortController()
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Accept: "text/event-stream" },
          signal: ac.signal,
          credentials: "same-origin",
        })
        if (!response.ok || !response.body) {
          throw new Error(`SSE HTTP ${response.status}`)
        }
        attempt = 0
        options?.onConnectionChange?.("open")
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (!closed) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split("\n\n")
          buffer = chunks.pop() ?? ""
          for (const chunk of chunks) {
            const dataLine = chunk
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("")
            if (!dataLine || dataLine === "[DONE]") continue
            try {
              const parsed = JSON.parse(dataLine) as { type?: string; properties?: unknown }
              if (parsed?.type) onEvent({ type: parsed.type, properties: parsed.properties })
            } catch {
              // ignore malformed
            }
          }
        }
        if (!closed) {
          options?.onConnectionChange?.("retry")
          schedule()
        }
      } catch (error) {
        if (closed || ac?.signal.aborted) return
        options?.onConnectionChange?.("retry")
        onEvent({
          type: "studio.sse.retry",
          properties: { message: error instanceof Error ? error.message : String(error) },
        })
        schedule()
      }
    })()
  }

  const schedule = () => {
    if (closed) return
    attempt += 1
    const delay = Math.min(8_000, 400 * 2 ** Math.min(attempt, 4))
    timer = setTimeout(connect, delay)
  }

  connect()

  return () => {
    closed = true
    options?.onConnectionChange?.("closed")
    if (timer) clearTimeout(timer)
    ac?.abort()
  }
}

function formatSdkError(error: unknown): string {
  if (!error) return "request failed"
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
