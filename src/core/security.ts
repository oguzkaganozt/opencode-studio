import { randomBytes, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"

export function assertNotRoot(action: string) {
  if (process.getuid?.() === 0 && !process.env.OPENCODE_STUDIO_ALLOW_ROOT) {
    throw new Error(`Refusing to ${action} as UID 0; run as the OpenCode user or set OPENCODE_STUDIO_ALLOW_ROOT=1`)
  }
}

export const BASE_CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; child-src 'self' blob:"

/**
 * PCB 3D (local Manifold/OCCT glue) needs both:
 * - 'wasm-unsafe-eval' for WebAssembly compile
 * - 'unsafe-eval' for Emscripten/Manifold string→JS glue (eval)
 * Scoped to PCB viewer paths only — not the whole host.
 * Domain STEP models may load from the kicad-mod-cache allowlist (connect-src only).
 */
export const PCB_CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: data: https://kicad-mod-cache.tscircuit.com; worker-src 'self' blob:; child-src 'self' blob:; media-src 'self' blob:"

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

export function assertLoopbackBind(hostname: string, allowNonLoopback = false) {
  if (allowNonLoopback) return
  if (isLoopbackHost(hostname)) return
  throw new Error(`Refusing non-loopback bind "${hostname}". Use 127.0.0.1/localhost, or pass --allow-non-loopback (dangerous).`)
}

/** Host allowlist derived from the actual bind address (plus paired loopback names when binding loopback). */
export function allowedHost(hostHeader: string | undefined, hostname: string, port: number) {
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

export function sameOrigin(origin: string | undefined, hostname: string, port: number, env: NodeJS.ProcessEnv = process.env) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    // Use url.host (keeps IPv6 brackets) with explicit port so IPv6 origins match.
    const explicitPort = url.port || (url.protocol === "https:" ? "443" : "80")
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

export function securityHeaders(csp = BASE_CSP): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": csp,
  }
}
