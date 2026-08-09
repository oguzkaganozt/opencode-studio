import { resolveEdgePassword } from "./security"

export type ServeBind = {
  hostname: string
  port: string
}

export type ExplicitParentSource = "OPENCODE_URL" | "OPENCODE_PARENT_URL" | "OPENCODE_STUDIO_PARENT" | "OPENCODE_SERVER_URL"

export type ExplicitParentRef = {
  raw: string
  source: ExplicitParentSource
}

export type ParentUrlMode = "supervisor-attach" | "supervisor-no-supervise" | "bootstrap" | "upgrade-report"

/** OPENCODE_PORT → OPENCODE_SERVER_PORT → 4096. */
export function resolveOpenCodePort(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { invalidDigits?: "default" | "keep" },
): { port: string; portNumber: number } {
  const raw = env.OPENCODE_PORT?.trim() || env.OPENCODE_SERVER_PORT?.trim()
  if (!raw) return { port: "4096", portNumber: 4096 }
  if (opts?.invalidDigits === "keep") return { port: raw, portNumber: /^\d+$/.test(raw) ? Number(raw) : 4096 }
  if (/^\d+$/.test(raw)) return { port: raw, portNumber: Number(raw) }
  return { port: "4096", portNumber: 4096 }
}

/** Upgrade/restart serve bind — not supervisor spawn host. */
export function resolveServeBind(env: NodeJS.ProcessEnv = process.env): ServeBind {
  const password = resolveEdgePassword(env)
  const hostname = env.OPENCODE_HOSTNAME?.trim() || env.OPENCODE_SERVER_HOSTNAME?.trim() || (password ? "0.0.0.0" : "127.0.0.1")
  const { port } = resolveOpenCodePort(env, { invalidDigits: "keep" })
  return { hostname, port }
}

/** Supervisor spawn: always loopback + validated port. */
export function resolveSuperviseSpawnBind(env: NodeJS.ProcessEnv = process.env): {
  hostname: "127.0.0.1"
  port: number
  baseUrl: string
} {
  const { portNumber } = resolveOpenCodePort(env, { invalidDigits: "default" })
  const hostname = "127.0.0.1" as const
  return { hostname, port: portNumber, baseUrl: `http://${hostname}:${portNumber}` }
}

/** Explicit parent URL for a mode. Does not probe or synthesize (except bootstrap). */
export function resolveExplicitParentOpenCode(env: NodeJS.ProcessEnv = process.env, mode: ParentUrlMode): ExplicitParentRef | undefined {
  if (mode === "supervisor-no-supervise") {
    const raw = env.OPENCODE_URL?.trim()
    return raw ? { raw, source: "OPENCODE_URL" } : undefined
  }
  if (mode === "supervisor-attach" || mode === "upgrade-report") {
    const url = env.OPENCODE_URL?.trim()
    if (url) return { raw: url, source: "OPENCODE_URL" }
    const parent = env.OPENCODE_PARENT_URL?.trim()
    if (parent) return { raw: parent, source: "OPENCODE_PARENT_URL" }
    return undefined
  }
  // bootstrap
  const studioParent = env.OPENCODE_STUDIO_PARENT?.trim()
  if (studioParent) return { raw: studioParent, source: "OPENCODE_STUDIO_PARENT" }
  const serverUrl = env.OPENCODE_SERVER_URL?.trim()
  if (serverUrl) return { raw: serverUrl, source: "OPENCODE_SERVER_URL" }
  const url = env.OPENCODE_URL?.trim()
  if (url) return { raw: url, source: "OPENCODE_URL" }
  return undefined
}

export function isHardParentUrl(source: ExplicitParentSource): boolean {
  return source === "OPENCODE_URL"
}

/** Bootstrap parent URL (explicit or synthetic). May keep 0.0.0.0 for Studio bind inheritance. */
export function defaultParentOpenCodeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = resolveExplicitParentOpenCode(env, "bootstrap")
  if (explicit) return explicit.raw.replace(/\/$/, "")
  const { port } = resolveOpenCodePort(env, { invalidDigits: "keep" })
  const publicBind = Boolean(env.OPENCODE_SERVER_PASSWORD || env.OPENCODE_STUDIO_PASSWORD || env.OPENCODE_STUDIO_BIND)
  const host = env.OPENCODE_STUDIO_PARENT_HOST?.trim() || (publicBind ? "0.0.0.0" : "127.0.0.1")
  return `http://${host}:${port}`
}

export function defaultLoopbackParentCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const { port } = resolveSuperviseSpawnBind(env)
  return [`http://127.0.0.1:${port}`]
}

export function resolveReportedServeUrl(env: NodeJS.ProcessEnv, serve: ServeBind): string {
  const explicit = resolveExplicitParentOpenCode(env, "upgrade-report")
  if (explicit) return explicit.raw
  return `http://${serve.hostname === "0.0.0.0" ? "127.0.0.1" : serve.hostname}:${serve.port}`
}
