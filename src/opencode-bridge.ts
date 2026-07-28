export type OpenCodeBridge = {
  proxy(request: Request): Promise<Response>
  webSocketTarget(requestUrl: string): Promise<string>
  close(): void
}

export type OpenCodeBridgeInput = {
  /** Parent OpenCode HTTP base (already normalized to a fetchable host). */
  baseUrl: string
  workspace: string
  env?: NodeJS.ProcessEnv
}

/** Rewrite bind-any hosts so fetch/WS can reach the parent from this process. */
export function normalizeParentOpenCodeUrl(raw: string | URL): string {
  const url = typeof raw === "string" ? new URL(raw) : new URL(raw.href)
  if (url.hostname === "0.0.0.0" || url.hostname === "::" || url.hostname === "[::]") {
    url.hostname = "127.0.0.1"
  }
  return url.href.replace(/\/$/, "")
}

function authHeaders(env: NodeJS.ProcessEnv) {
  const password = env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = env.OPENCODE_SERVER_USERNAME || "opencode"
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
}

/**
 * Attach-only reverse proxy to a parent OpenCode server.
 * Studio never spawns OpenCode.
 */
export function createOpenCodeBridge(input: OpenCodeBridgeInput): OpenCodeBridge {
  const baseUrl = normalizeParentOpenCodeUrl(input.baseUrl)
  const workspace = input.workspace
  const env = input.env ?? process.env

  return {
    async proxy(request) {
      const incoming = new URL(request.url)
      const upstream = new URL(`${incoming.pathname}${incoming.search}`, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
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
    },
    async webSocketTarget(requestUrl) {
      const incoming = new URL(requestUrl)
      const target = new URL(`${incoming.pathname}${incoming.search}`, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
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
    },
    close() {
      // Attach-only: nothing owned to tear down.
    },
  }
}
