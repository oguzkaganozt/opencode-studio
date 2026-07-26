import path from "node:path"
import type { Message, Part, PermissionRequest, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2"
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2"

export type ChatMessage = { info: Message; parts: Part[] }

export type ChatState = {
  messages: ChatMessage[]
  status: { type: string; [key: string]: unknown }
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
}

export type OpenCodeBridge = {
  health(): Promise<{ healthy: boolean; version?: string }>
  sessions(): Promise<Session[]>
  createSession(input: { title: string; studioId: string }): Promise<Session>
  state(sessionID: string): Promise<ChatState>
  prompt(sessionID: string, text: string): Promise<void>
  abort(sessionID: string): Promise<void>
  replyPermission(requestID: string, reply: "once" | "always" | "reject"): Promise<void>
  replyQuestion(requestID: string, answers: QuestionAnswer[]): Promise<void>
  proxy(request: Request): Promise<Response>
  webSocketTarget(requestUrl: string): Promise<string>
  close(): void
}

function authHeaders(env: NodeJS.ProcessEnv) {
  const password = env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = env.OPENCODE_SERVER_USERNAME || "opencode"
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
}

export function createOpenCodeBridge(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
  startServer: typeof createOpencodeServer = createOpencodeServer,
): OpenCodeBridge {
  type Connection = {
    client: ReturnType<typeof createOpencodeClient>
    baseUrl: string
    server?: { close(): void }
  }
  let connection: Promise<Connection> | undefined
  let ownedServer: { close(): void } | undefined
  let startupAbort: AbortController | undefined

  const reset = () => {
    startupAbort?.abort()
    startupAbort = undefined
    ownedServer?.close()
    ownedServer = undefined
    connection = undefined
  }

  const connect = () => {
    if (connection) return connection
    const controller = new AbortController()
    startupAbort = controller
    const pending = (async (): Promise<Connection> => {
      const configuredUrl = env.OPENCODE_STUDIO_OPENCODE_URL?.trim()
      const server = configuredUrl
        ? undefined
        : await startServer({ hostname: "127.0.0.1", port: 0, timeout: 20_000, signal: controller.signal })
      if (controller.signal.aborted) {
        server?.close()
        throw new Error("OpenCode connection was closed")
      }
      ownedServer = server
      const baseUrl = configuredUrl || server?.url
      if (!baseUrl) throw new Error("OpenCode server URL is unavailable")
      const client = createOpencodeClient({ baseUrl, directory: workspace, headers: authHeaders(env) })
      return { client, baseUrl, server }
    })()
    connection = pending.catch((error) => {
      if (connection === pending || connection === guarded) reset()
      throw error
    })
    const guarded = connection
    const clearStartup = () => {
      if (startupAbort === controller) startupAbort = undefined
    }
    void guarded.then(clearStartup, clearStartup)
    return guarded
  }

  const run = async <T>(operation: (client: ReturnType<typeof createOpencodeClient>) => Promise<T>) => {
    const activeConnection = connect()
    const active = await activeConnection
    try {
      return await operation(active.client)
    } catch (error) {
      const status = (error as { cause?: { status?: unknown } })?.cause?.status
      if (typeof status !== "number" && connection === activeConnection) reset()
      throw error
    }
  }

  const assertSessionOwned = async (client: ReturnType<typeof createOpencodeClient>, sessionID: string) => {
    const result = await client.session.get({ sessionID }, { throwOnError: true })
    if (path.resolve(result.data.directory) !== path.resolve(workspace)) throw new Error("OpenCode session is outside the Studio workspace")
  }

  const withConnection = async <T>(operation: (active: Connection) => Promise<T>) => {
    const activeConnection = connect()
    const active = await activeConnection
    try {
      return await operation(active)
    } catch (error) {
      const status = (error as { cause?: { status?: unknown } })?.cause?.status
      if (typeof status !== "number" && connection === activeConnection) reset()
      throw error
    }
  }

  return {
    async health() {
      return run(async (client) => {
        const result = await client.global.health({ throwOnError: true })
        return result.data
      })
    },
    async sessions() {
      return run(async (client) => {
        const result = await client.session.list({ limit: 40 }, { throwOnError: true })
        return result.data.filter((session) => path.resolve(session.directory) === path.resolve(workspace))
      })
    },
    async createSession(input) {
      return run(async (client) => {
        const result = await client.session.create(
          { title: input.title, agent: "build", metadata: { "opencode-studio": input.studioId } },
          { throwOnError: true },
        )
        return result.data
      })
    },
    async state(sessionID) {
      return run(async (client) => {
        await assertSessionOwned(client, sessionID)
        const [messages, statuses, permissions, questions] = await Promise.all([
          client.session.messages({ sessionID, limit: 100 }, { throwOnError: true }),
          client.session.status({}, { throwOnError: true }),
          client.permission.list({}, { throwOnError: true }),
          client.question.list({}, { throwOnError: true }),
        ])
        return {
          messages: messages.data,
          status: statuses.data[sessionID] ?? { type: "idle" },
          permissions: permissions.data.filter((item) => item.sessionID === sessionID),
          questions: questions.data.filter((item) => item.sessionID === sessionID),
        }
      })
    },
    async prompt(sessionID, text) {
      await run(async (client) => {
        await assertSessionOwned(client, sessionID)
        await client.session.promptAsync({ sessionID, agent: "build", parts: [{ type: "text", text }] }, { throwOnError: true })
      })
    },
    async abort(sessionID) {
      await run(async (client) => {
        await assertSessionOwned(client, sessionID)
        await client.session.abort({ sessionID }, { throwOnError: true })
      })
    },
    async replyPermission(requestID, reply) {
      await run(async (client) => {
        const requests = await client.permission.list({}, { throwOnError: true })
        const request = requests.data.find((item) => item.id === requestID)
        if (!request) throw new Error("OpenCode permission request was not found in the Studio workspace")
        await assertSessionOwned(client, request.sessionID)
        await client.permission.reply({ requestID, reply }, { throwOnError: true })
      })
    },
    async replyQuestion(requestID, answers) {
      await run(async (client) => {
        const requests = await client.question.list({}, { throwOnError: true })
        const request = requests.data.find((item) => item.id === requestID)
        if (!request) throw new Error("OpenCode question request was not found in the Studio workspace")
        await assertSessionOwned(client, request.sessionID)
        await client.question.reply({ requestID, answers }, { throwOnError: true })
      })
    },
    async proxy(request) {
      return withConnection(async ({ baseUrl, server }) => {
        if (!server) throw new Error("Native OpenCode proxy requires the Studio-owned sidecar")
        const incoming = new URL(request.url)
        const upstream = new URL(`${incoming.pathname}${incoming.search}`, baseUrl)
        const headers = new Headers(request.headers)
        headers.delete("host")
        headers.delete("origin")
        headers.delete("authorization")
        headers.delete("x-opencode-directory")
        headers.delete("x-opencode-workspace")
        headers.set("accept-encoding", "identity")
        headers.delete("connection")
        for (const [key, value] of Object.entries(authHeaders(env) ?? {})) headers.set(key, value)
        for (const key of ["directory", "workspace", "location[directory]", "location[workspace]"]) upstream.searchParams.delete(key)
        const isStatic =
          upstream.pathname === "/" ||
          upstream.pathname.startsWith("/assets/") ||
          /\.(?:png|svg|ico|webmanifest|woff2?|ttf)$/i.test(upstream.pathname)
        if (!isStatic) {
          upstream.searchParams.set("directory", workspace)
          upstream.searchParams.set("location[directory]", workspace)
          headers.set("x-opencode-directory", encodeURIComponent(workspace))
        }
        let body: BodyInit | null | undefined = request.method === "GET" || request.method === "HEAD" ? undefined : request.body
        if (body && headers.get("content-type")?.toLowerCase().includes("application/json")) {
          const text = await request.text()
          body = text
          try {
            const value = JSON.parse(text) as Record<string, unknown>
            if (value && typeof value === "object" && !Array.isArray(value)) {
              if (value.location && typeof value.location === "object" && !Array.isArray(value.location)) {
                const location: Record<string, unknown> = { ...(value.location as Record<string, unknown>), directory: workspace }
                delete location.workspace
                value.location = location
              }
              body = JSON.stringify(value)
              headers.delete("content-length")
            }
          } catch {
            // Let OpenCode return its normal malformed-JSON response.
          }
        }
        const response = await fetch(upstream, {
          method: request.method,
          headers,
          body,
          redirect: "manual",
        })
        const responseHeaders = new Headers(response.headers)
        for (const key of ["connection", "content-encoding", "content-length", "transfer-encoding"]) responseHeaders.delete(key)
        const location = responseHeaders.get("location")
        if (location?.startsWith(baseUrl)) responseHeaders.set("location", `${incoming.origin}${location.slice(baseUrl.length)}`)
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
      })
    },
    async webSocketTarget(requestUrl) {
      return withConnection(async ({ baseUrl, server }) => {
        if (!server) throw new Error("Native OpenCode proxy requires the Studio-owned sidecar")
        const incoming = new URL(requestUrl)
        const target = new URL(`${incoming.pathname}${incoming.search}`, baseUrl)
        for (const key of ["directory", "workspace", "location[directory]", "location[workspace]"]) target.searchParams.delete(key)
        target.searchParams.set("directory", workspace)
        target.searchParams.set("location[directory]", workspace)
        target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
        const password = env.OPENCODE_SERVER_PASSWORD
        if (password) {
          target.username = env.OPENCODE_SERVER_USERNAME || "opencode"
          target.password = password
        }
        return target.toString()
      })
    },
    close() {
      reset()
    },
  }
}
