import path from "node:path"
import { packageRootFrom } from "./core/paths"
import { assertNonLoopbackPassword, envFalsy } from "./core/security"
import { normalizeParentOpenCodeUrl, probeParentOpenCode } from "./opencode-bridge"
import { type HostHandle, startHost } from "./server"
import { fetchStudioHealth, resolveStudioBind, type StudioBind, studioHealthOk } from "./studio-host-bind"

export type { StudioBind }
export { probeParentOpenCode, resolveStudioBind }

export type EnsureStudioHostInput = {
  parentOpenCodeUrl: string
  /** Immutable Studio filesystem root for this host process. */
  studioRoot: string
  packageRoot?: string
  uiDirectory?: string
  env?: NodeJS.ProcessEnv
  autostart?: string
}

export type EnsureStudioHostResult =
  | { ok: true; hostUrl: string; studioUrl: string; reused: boolean; studioRoot: string }
  | { ok: false; reason: string }

let state: { bind: StudioBind; handle: HostHandle; studioRoot: string } | undefined
let starting: Promise<EnsureStudioHostResult> | undefined

export function autostartDisabled(value: string | undefined) {
  return envFalsy(value)
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

function portBusyReason(port: number, message: string) {
  if (/EADDRINUSE|address already in use/i.test(message)) {
    return `port ${port} is in use; set OPENCODE_STUDIO_PORT or free the port`
  }
  return message
}

async function ensureStudioHostLocked(input: EnsureStudioHostInput, env: NodeJS.ProcessEnv): Promise<EnsureStudioHostResult> {
  const parentUrl = normalizeParentOpenCodeUrl(input.parentOpenCodeUrl)
  const studioRoot = path.resolve(input.studioRoot)
  let bind: StudioBind
  try {
    bind = resolveStudioBind(input.parentOpenCodeUrl, env)
    assertNonLoopbackPassword(bind.hostname, env)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  // A process owns one immutable Studio Home. OpenCode project context is request-scoped.
  if (state && state.bind.port === bind.port && state.bind.hostname === bind.hostname && (await studioHealthOk(state.bind.localUrl))) {
    if (state.studioRoot !== studioRoot) {
      return {
        ok: false,
        reason: `Studio host already uses ${state.studioRoot}; restart it to use ${studioRoot}`,
      }
    }
    return {
      ok: true,
      hostUrl: state.bind.localUrl,
      studioUrl: `${state.bind.localUrl}/studio`,
      reused: true,
      studioRoot: state.studioRoot,
    }
  }
  if (state) {
    try {
      state.handle.stop()
    } catch {
      // ignore
    }
    state = undefined
  }

  const existingRoot = await readStudioHostRoot(bind.localUrl)
  if (existingRoot) {
    if (existingRoot !== studioRoot) {
      return {
        ok: false,
        reason: `Studio host already uses ${existingRoot}; restart it to use ${studioRoot}`,
      }
    }
    return {
      ok: true,
      hostUrl: bind.localUrl,
      studioUrl: `${bind.localUrl}/studio`,
      reused: true,
      studioRoot,
    }
  }

  if (!(await probeParentOpenCode(parentUrl, env))) {
    return { ok: false, reason: `parent OpenCode not reachable at ${parentUrl}` }
  }

  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  try {
    const handle = await startHost({
      studioRoot,
      parentOpenCodeUrl: parentUrl,
      hostname: bind.hostname,
      port: bind.port,
      packageRoot,
      uiDirectory: input.uiDirectory ?? path.join(packageRoot, "dist", "ui"),
      env,
      handleSignals: false,
    })
    const localUrl = `http://127.0.0.1:${handle.server.port}`
    state = {
      bind: { ...bind, port: handle.server.port ?? bind.port, localUrl },
      handle,
      studioRoot,
    }
    return { ok: true, hostUrl: localUrl, studioUrl: `${localUrl}/studio`, reused: false, studioRoot }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: portBusyReason(bind.port, message) }
  }
}

async function readStudioHostRoot(localUrl: string): Promise<string | undefined> {
  const health = await fetchStudioHealth(localUrl)
  if (!health.ok || !health.studioRoot || !path.isAbsolute(health.studioRoot)) return undefined
  return path.resolve(health.studioRoot)
}

export function stopOwnedStudioHost() {
  try {
    state?.handle.stop()
  } catch {
    // ignore
  }
  state = undefined
}

export function resetStudioHostEnsureForTests() {
  stopOwnedStudioHost()
  starting = undefined
}
