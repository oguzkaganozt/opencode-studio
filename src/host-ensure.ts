import path from "node:path"
import { packageRootFrom } from "./core/paths"
import { assertNonLoopbackPassword } from "./core/security"
import { normalizeParentOpenCodeUrl } from "./opencode-bridge"
import { type HostHandle, startHost } from "./server"

export const STUDIO_HOST_PORT = 4173
export const DEFAULT_STUDIO_HOST_URL = `http://127.0.0.1:${STUDIO_HOST_PORT}`

export type StudioBind = {
  hostname: string
  port: number
  localUrl: string
}

export type EnsureStudioHostInput = {
  parentOpenCodeUrl: string
  workspace: string
  packageRoot?: string
  uiDirectory?: string
  env?: NodeJS.ProcessEnv
  autostart?: string
}

export type EnsureStudioHostResult = { ok: true; hostUrl: string; studioUrl: string; reused: boolean } | { ok: false; reason: string }

let state: { bind: StudioBind; handle: HostHandle } | undefined
let starting: Promise<EnsureStudioHostResult> | undefined

function autostartDisabled(value: string | undefined) {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === "0" || v === "false" || v === "no" || v === "off"
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

export async function probeParentOpenCode(baseUrl: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const url = normalizeParentOpenCodeUrl(baseUrl)
  const headers = new Headers()
  const password = env.OPENCODE_SERVER_PASSWORD
  if (password) {
    const username = env.OPENCODE_SERVER_USERNAME || "opencode"
    headers.set("Authorization", `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`)
  }
  try {
    const response = await fetch(new URL("/global/health", `${url}/`), {
      headers,
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function studioHealthOk(localUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/studio-api/health", `${localUrl}/`), { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch {
    return false
  }
}

export async function ensureStudioHost(input: EnsureStudioHostInput): Promise<EnsureStudioHostResult> {
  const env = input.env ?? process.env
  if (autostartDisabled(input.autostart ?? env.OPENCODE_STUDIO_AUTOSTART)) {
    return { ok: false, reason: "OPENCODE_STUDIO_AUTOSTART disabled" }
  }
  if (starting) return starting
  starting = ensureStudioHostLocked(input, env).finally(() => {
    starting = undefined
  })
  return starting
}

async function ensureStudioHostLocked(input: EnsureStudioHostInput, env: NodeJS.ProcessEnv): Promise<EnsureStudioHostResult> {
  const parentUrl = normalizeParentOpenCodeUrl(input.parentOpenCodeUrl)
  let bind: StudioBind
  try {
    bind = resolveStudioBind(input.parentOpenCodeUrl, env)
    assertNonLoopbackPassword(bind.hostname, env)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  if (state && state.bind.port === bind.port && state.bind.hostname === bind.hostname && (await studioHealthOk(state.bind.localUrl))) {
    return { ok: true, hostUrl: state.bind.localUrl, studioUrl: `${state.bind.localUrl}/studio`, reused: true }
  }
  if (state) {
    try {
      state.handle.stop()
    } catch {
      // ignore
    }
    state = undefined
  }

  if (await studioHealthOk(bind.localUrl)) {
    return { ok: true, hostUrl: bind.localUrl, studioUrl: `${bind.localUrl}/studio`, reused: true }
  }

  if (!(await probeParentOpenCode(parentUrl, env))) {
    return { ok: false, reason: `parent OpenCode not reachable at ${parentUrl}` }
  }

  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  try {
    const handle = await startHost({
      workspace: input.workspace,
      parentOpenCodeUrl: parentUrl,
      hostname: bind.hostname,
      port: bind.port,
      packageRoot,
      uiDirectory: input.uiDirectory ?? path.join(packageRoot, "dist", "ui"),
      env,
      handleSignals: false,
    })
    const localUrl = `http://127.0.0.1:${handle.server.port}`
    state = { bind: { ...bind, port: handle.server.port ?? bind.port, localUrl }, handle }
    return { ok: true, hostUrl: localUrl, studioUrl: `${localUrl}/studio`, reused: false }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export function resetStudioHostEnsureForTests() {
  try {
    state?.handle.stop()
  } catch {
    // ignore
  }
  state = undefined
  starting = undefined
}
