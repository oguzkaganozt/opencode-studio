import path from "node:path"

export type OpenCodeBridge = {
  proxy(request: Request): Promise<Response>
  webSocketTarget(requestUrl: string): Promise<string>
  close(): void
}

export type OpenCodeBridgeInput = {
  /** Parent OpenCode HTTP base (already normalized to a fetchable host). */
  baseUrl: string
  /** Fixed fallback directory when the client does not choose a project. */
  studioRoot: string
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

/** Basic auth headers for parent OpenCode when OPENCODE_SERVER_PASSWORD is set. */
export function openCodeBasicAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> | undefined {
  const password = env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = env.OPENCODE_SERVER_USERNAME || "opencode"
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
}

function absoluteDirectory(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null
  let value = raw.trim()
  if (!value) return null
  try {
    value = decodeURIComponent(value)
  } catch {
    // keep raw
  }
  if (!path.isAbsolute(value)) return null
  return path.resolve(value)
}

/** Prefer client directory (OpenCode multi-project UI); else the fixed Studio Home. */
export function resolveBridgeDirectory(request: Request, fallbackDirectory: string): string {
  const url = new URL(request.url)
  const fromQuery = absoluteDirectory(url.searchParams.get("directory")) ?? absoluteDirectory(url.searchParams.get("location[directory]"))
  if (fromQuery) return fromQuery
  const header = request.headers.get("x-opencode-directory")
  const fromHeader = absoluteDirectory(header)
  if (fromHeader) return fromHeader
  return path.resolve(fallbackDirectory)
}

/**
 * Attach-only reverse proxy to a parent OpenCode server.
 * Studio never spawns OpenCode.
 * Directory follows the client when present so Agent UI stays multi-project; otherwise uses Studio Home.
 */
export function createOpenCodeBridge(input: OpenCodeBridgeInput): OpenCodeBridge {
  const baseUrl = normalizeParentOpenCodeUrl(input.baseUrl)
  const studioRoot = path.resolve(input.studioRoot)
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
      for (const [key, value] of Object.entries(openCodeBasicAuthHeaders(env) ?? {})) headers.set(key, value)
      for (const key of ["directory", "workspace", "location[directory]", "location[workspace]"]) upstream.searchParams.delete(key)
      const isStatic =
        upstream.pathname === "/" ||
        upstream.pathname.startsWith("/assets/") ||
        /\.(?:png|svg|ico|webmanifest|woff2?|ttf)$/i.test(upstream.pathname)
      const directory = isStatic ? studioRoot : resolveBridgeDirectory(request, studioRoot)
      if (!isStatic) {
        upstream.searchParams.set("directory", directory)
        upstream.searchParams.set("location[directory]", directory)
        headers.set("x-opencode-directory", encodeURIComponent(directory))
      }
      let body: BodyInit | null | undefined = request.method === "GET" || request.method === "HEAD" ? undefined : request.body
      if (body && headers.get("content-type")?.toLowerCase().includes("application/json")) {
        const text = await request.text()
        body = text
        try {
          const value = JSON.parse(text) as Record<string, unknown>
          if (value && typeof value === "object" && !Array.isArray(value)) {
            if (value.location && typeof value.location === "object" && !Array.isArray(value.location)) {
              const loc = value.location as Record<string, unknown>
              const bodyDir = absoluteDirectory(typeof loc.directory === "string" ? loc.directory : undefined)
              const location: Record<string, unknown> = {
                ...loc,
                directory: bodyDir ?? directory,
              }
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
      const directory =
        absoluteDirectory(incoming.searchParams.get("directory")) ??
        absoluteDirectory(incoming.searchParams.get("location[directory]")) ??
        studioRoot
      target.searchParams.set("directory", directory)
      target.searchParams.set("location[directory]", directory)
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
