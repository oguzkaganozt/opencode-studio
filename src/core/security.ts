import { randomBytes } from "node:crypto"
import { isIP } from "node:net"

export function assertNotRoot(action: string) {
  if (process.getuid?.() === 0 && !process.env.OPENCODE_STUDIO_ALLOW_ROOT) {
    throw new Error(`Refusing to ${action} as UID 0; run as the OpenCode user or set OPENCODE_STUDIO_ALLOW_ROOT=1`)
  }
}

export const BASE_CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; child-src 'self' blob:"

/**
 * PCB 3D needs wasm-eval for local Emscripten Manifold/OCCT glue.
 * Domain STEP models may load from the kicad-mod-cache allowlist (connect-src only).
 * Applied only to PCB viewer document paths, not the whole host.
 */
export const PCB_CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: data: https://kicad-mod-cache.tscircuit.com; worker-src 'self' blob:; child-src 'self' blob:; media-src 'self' blob:"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

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

export function sameOrigin(origin: string | undefined, hostname: string, port: number) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname
    return (
      allowedHost(host, hostname, port) ||
      allowedHost(`${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`, hostname, port)
    )
  } catch {
    return false
  }
}

export function securityHeaders(csp = BASE_CSP): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": csp,
  }
}
