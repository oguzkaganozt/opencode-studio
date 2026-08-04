import { randomBytes, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"

export function assertNotRoot(action: string) {
  if (process.getuid?.() === 0 && !process.env.OPENCODE_STUDIO_ALLOW_ROOT) {
    throw new Error(`Refusing to ${action} as UID 0; run as the OpenCode user or set OPENCODE_STUDIO_ALLOW_ROOT=1`)
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

/** Default Vite dev UI port; allowed as Origin when the host binds loopback. */
export const DEFAULT_DEV_UI_PORTS = [5173]

export function isLoopbackHost(hostname: string) {
  const host = hostname.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(host)) return true
  if (host.startsWith("[") && host.endsWith("]")) return isLoopbackHost(host.slice(1, -1))
  const ipVersion = isIP(host)
  if (ipVersion === 4) return host === "127.0.0.1" || host.startsWith("127.")
  if (ipVersion === 6) return host === "::1" || host === "0:0:0:0:0:0:0:1"
  return false
}

/** CLI bind modes: local (loopback) or web (all interfaces). */
export type BindMode = "local" | "web"

export const BIND_MODE_HOST: Record<BindMode, string> = {
  local: "127.0.0.1",
  web: "0.0.0.0",
}

/**
 * Resolve mutually exclusive `--local` / `--web` flags.
 * Default is local when neither is set.
 */
export function resolveBindMode(flags: { local?: boolean; web?: boolean }): BindMode {
  const local = Boolean(flags.local)
  const web = Boolean(flags.web)
  if (local && web) throw new Error("Use either --local or --web, not both")
  return web ? "web" : "local"
}

export function hostnameForBindMode(mode: BindMode): string {
  return BIND_MODE_HOST[mode]
}

export const DEFAULT_BASIC_USERNAME = "opencode-studio"

/** OPENCODE_STUDIO_PASSWORD or OPENCODE_SERVER_PASSWORD. */
export function resolveEdgePassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const p = env.OPENCODE_STUDIO_PASSWORD?.trim() || env.OPENCODE_SERVER_PASSWORD?.trim()
  return p || undefined
}

/** Studio user → server user → opencode (server pw only) → opencode-studio. */
export function resolveBasicUsername(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.OPENCODE_STUDIO_USERNAME?.trim() ||
    env.OPENCODE_SERVER_USERNAME?.trim() ||
    (env.OPENCODE_SERVER_PASSWORD && !env.OPENCODE_STUDIO_PASSWORD ? "opencode" : DEFAULT_BASIC_USERNAME)
  )
}

export function assertWebPassword(mode: BindMode, env: NodeJS.ProcessEnv = process.env) {
  if (mode === "web" && !resolveEdgePassword(env)) {
    throw new Error("web mode requires OPENCODE_STUDIO_PASSWORD or OPENCODE_SERVER_PASSWORD")
  }
}

export function assertNonLoopbackPassword(hostname: string, env: NodeJS.ProcessEnv = process.env) {
  if (!isLoopbackHost(hostname) && !resolveEdgePassword(env)) {
    throw new Error("non-loopback bind requires OPENCODE_STUDIO_PASSWORD or OPENCODE_SERVER_PASSWORD")
  }
}

/** Host allowlist derived from the actual bind address (plus paired loopback names when binding loopback). */
export function allowedHost(hostHeader: string | undefined, hostname: string, port: number) {
  if (!isLoopbackHost(hostname)) return true
  if (!hostHeader || /[\0\r\n\s]/.test(hostHeader)) return false
  const allowed = new Set<string>([`${hostname}:${port}`, hostname])
  if (isLoopbackHost(hostname)) {
    for (const name of ["127.0.0.1", "localhost", "[::1]", "::1"]) {
      allowed.add(name)
      allowed.add(`${name}:${port}`)
    }
  }
  return allowed.has(hostHeader)
}

/** RFC 6266 / 5987-safe Content-Disposition attachment header. */
export function safeContentDisposition(filename: string) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_") || "download"
  const encoded = encodeURIComponent(filename)
    .replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A")
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function createCsrfToken() {
  return randomBytes(32).toString("base64url")
}

export function csrfTokensEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

export function basicAuthMatches(header: string | undefined, username: string, password: string) {
  if (!header?.startsWith("Basic ")) return false
  let decoded: string
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8")
  } catch {
    return false
  }
  const separator = decoded.indexOf(":")
  if (separator < 0) return false
  return csrfTokensEqual(decoded.slice(0, separator), username) && csrfTokensEqual(decoded.slice(separator + 1), password)
}

/**
 * Origins allowed for mutating requests.
 * - Exact bind host:port (and loopback aliases on that port)
 * - When bind is loopback: Vite default port(s) on loopback hosts
 * - Extra absolute origins from OPENCODE_STUDIO_ALLOWED_ORIGINS (comma-separated)
 */
export function allowedOrigins(hostname: string, port: number, env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origins = new Set<string>()
  const add = (host: string, p: number) => {
    origins.add(`http://${host}:${p}`)
    origins.add(`https://${host}:${p}`)
  }

  add(hostname, port)
  if (isLoopbackHost(hostname)) {
    for (const name of ["127.0.0.1", "localhost", "[::1]"]) {
      add(name, port)
      for (const devPort of DEFAULT_DEV_UI_PORTS) add(name, devPort)
    }
  }

  const extra = env.OPENCODE_STUDIO_ALLOWED_ORIGINS
  if (extra) {
    for (const part of extra.split(",")) {
      const trimmed = part.trim()
      if (!trimmed) continue
      try {
        const url = new URL(trimmed)
        if (url.protocol === "http:" || url.protocol === "https:") {
          origins.add(`${url.protocol}//${url.host}`)
        }
      } catch {
        // ignore malformed entries
      }
    }
  }
  return origins
}

export function sameOrigin(
  origin: string | undefined,
  hostname: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  requestHost?: string,
) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    // Use url.host (keeps IPv6 brackets) with explicit port so IPv6 origins match.
    const explicitPort = url.port || (url.protocol === "https:" ? "443" : "80")
    if (!isLoopbackHost(hostname) && requestHost && url.host === requestHost) return true
    const normalized = `${url.protocol}//${url.host.split(":")[0]}:${explicitPort}`
    return allowedOrigins(hostname, port, env).has(normalized)
  } catch {
    return false
  }
}

/** Safe http(s) URL for viewer links; rejects javascript:/data:/etc. */
export function safeExternalHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

/** Minimal headers only — no CSP (loopback internal tool; Manifold/3D needs eval+wasm). */
export function securityHeaders(): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
  }
}
