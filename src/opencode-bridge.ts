import { createOpencodeServer } from "@opencode-ai/sdk/v2"

export type OpenCodeBridge = {
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
      return { baseUrl, server }
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
