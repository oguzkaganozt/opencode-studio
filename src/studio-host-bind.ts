import path from "node:path"

export const STUDIO_HOST_PORT = 4173
export const DEFAULT_STUDIO_HOST_URL = `http://127.0.0.1:${STUDIO_HOST_PORT}`

export type StudioBind = {
  hostname: string
  port: number
  localUrl: string
}

/** Bind: env override, else parent 0.0.0.0 → web, else loopback. Port: OPENCODE_STUDIO_PORT || 4173. */
export function resolveStudioBind(parentOpenCodeUrl: string, env: NodeJS.ProcessEnv = process.env): StudioBind {
  let parentHost = "127.0.0.1"
  try {
    parentHost = new URL(parentOpenCodeUrl).hostname
  } catch {
    // ignore
  }

  const envHost = env.OPENCODE_STUDIO_HOSTNAME?.trim()
  const envBind = env.OPENCODE_STUDIO_BIND?.trim().toLowerCase()
  let hostname = "127.0.0.1"
  if (envHost) hostname = envHost === "::" || envHost === "[::]" ? "0.0.0.0" : envHost
  else if (envBind === "0.0.0.0" || envBind === "web" || envBind === "all") hostname = "0.0.0.0"
  else if (parentHost === "0.0.0.0" || parentHost === "::" || parentHost === "[::]") hostname = "0.0.0.0"

  const rawPort = env.OPENCODE_STUDIO_PORT?.trim()
  const port = rawPort ? Number(rawPort) : STUDIO_HOST_PORT
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid OPENCODE_STUDIO_PORT: ${rawPort}`)

  return { hostname, port, localUrl: `http://127.0.0.1:${port}` }
}

export async function fetchStudioHealth(localUrl: string): Promise<{ ok: boolean; studioRoot?: string }> {
  try {
    const response = await fetch(new URL("/studio-api/health", `${localUrl}/`), { signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return { ok: false }
    const body = (await response.json().catch(() => null)) as { studioRoot?: unknown } | null
    const studioRoot = body && typeof body.studioRoot === "string" && path.isAbsolute(body.studioRoot) ? body.studioRoot : undefined
    return { ok: true, studioRoot }
  } catch {
    return { ok: false }
  }
}

export async function studioHealthOk(localUrl: string): Promise<boolean> {
  return (await fetchStudioHealth(localUrl)).ok
}

/** Probe loopback Studio health for CLI status (env port/bind). Does not claim ownership. */
export async function probeLocalStudioHost(env: NodeJS.ProcessEnv = process.env): Promise<{ url: string; ok: boolean }> {
  let url = DEFAULT_STUDIO_HOST_URL
  try {
    url = resolveStudioBind("http://127.0.0.1:4096", env).localUrl
  } catch {
    // keep default
  }
  return { url, ok: await studioHealthOk(url) }
}
