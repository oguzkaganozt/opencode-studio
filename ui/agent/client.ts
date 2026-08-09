import { createOpencodeClient, type Message, type OpencodeClient, type Part, type Session } from "@opencode-ai/sdk/client"

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
    const data = (await response.json().catch(() => null)) as { healthy?: boolean; version?: string } | null
    return { ok: data?.healthy !== false, version: data?.version }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function listSessions(directory?: string): Promise<Session[]> {
  const client = createAgentClient(directory)
  const result = await client.session.list({ query: directory ? { directory } : undefined })
  if (result.error) throw new Error(formatSdkError(result.error))
  const rows = result.data ?? []
  return [...rows].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
}

export async function createSession(directory?: string, title?: string): Promise<Session> {
  const client = createAgentClient(directory)
  const result = await client.session.create({
    query: directory ? { directory } : undefined,
    body: title ? { title } : undefined,
  })
  if (result.error || !result.data) throw new Error(formatSdkError(result.error) || "create session failed")
  return result.data
}

export async function listMessages(sessionID: string, directory?: string): Promise<AgentMessage[]> {
  const client = createAgentClient(directory)
  const result = await client.session.messages({
    path: { id: sessionID },
    query: directory ? { directory } : undefined,
  })
  if (result.error) throw new Error(formatSdkError(result.error))
  return (result.data ?? []) as AgentMessage[]
}

export async function promptSessionAsync(input: {
  sessionID: string
  text: string
  directory?: string
  agent?: string
  model?: { providerID: string; modelID: string }
}): Promise<void> {
  const client = createAgentClient(input.directory)
  const result = await client.session.promptAsync({
    path: { id: input.sessionID },
    query: input.directory ? { directory: input.directory } : undefined,
    body: {
      agent: input.agent,
      model: input.model,
      parts: [{ type: "text", text: input.text }],
    },
  })
  if (result.error) throw new Error(formatSdkError(result.error))
}

export async function abortSession(sessionID: string, directory?: string): Promise<void> {
  const client = createAgentClient(directory)
  const result = await client.session.abort({
    path: { id: sessionID },
    query: directory ? { directory } : undefined,
  })
  if (result.error) throw new Error(formatSdkError(result.error))
}

export async function replyPermission(input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}): Promise<void> {
  const client = createAgentClient(input.directory)
  const result = await client.postSessionIdPermissionsPermissionId({
    path: { id: input.sessionID, permissionID: input.permissionID },
    query: input.directory ? { directory: input.directory } : undefined,
    body: { response: input.response },
  })
  if (result.error) throw new Error(formatSdkError(result.error))
}

export async function sessionDiff(sessionID: string, directory?: string) {
  const client = createAgentClient(directory)
  const result = await client.session.diff({
    path: { id: sessionID },
    query: directory ? { directory } : undefined,
  })
  if (result.error) throw new Error(formatSdkError(result.error))
  return result.data ?? []
}

export async function listAgents(directory?: string) {
  const client = createAgentClient(directory)
  const result = await client.app.agents({ query: directory ? { directory } : undefined })
  if (result.error) throw new Error(formatSdkError(result.error))
  return result.data ?? []
}

export async function listProviders(directory?: string) {
  const client = createAgentClient(directory)
  const result = await client.config.providers({ query: directory ? { directory } : undefined })
  if (result.error) throw new Error(formatSdkError(result.error))
  return result.data
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
