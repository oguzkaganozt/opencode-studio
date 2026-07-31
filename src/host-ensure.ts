import path from "node:path"
import { packageRootFrom } from "./core/paths"
import { assertNonLoopbackPassword } from "./core/security"
import { normalizeParentOpenCodeUrl, openCodeBasicAuthHeaders } from "./opencode-bridge"
import { type HostHandle, startHost } from "./server"
import {
  DEFAULT_STUDIO_HOST_URL,
  probeLocalStudioHost,
  resolveStudioBind,
  STUDIO_HOST_PORT,
  type StudioBind,
  studioHealthOk,
} from "./studio-host-bind"

export type { StudioBind }
export { DEFAULT_STUDIO_HOST_URL, probeLocalStudioHost, resolveStudioBind, STUDIO_HOST_PORT }

export type EnsureStudioHostInput = {
  parentOpenCodeUrl: string
  workspace: string
  packageRoot?: string
  uiDirectory?: string
  env?: NodeJS.ProcessEnv
  autostart?: string
}

export type EnsureStudioHostResult =
  | { ok: true; hostUrl: string; studioUrl: string; reused: boolean; workspace: string }
  | { ok: false; reason: string }

let state: { bind: StudioBind; handle: HostHandle; workspace: string } | undefined
let starting: Promise<EnsureStudioHostResult> | undefined

function autostartDisabled(value: string | undefined) {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === "0" || v === "false" || v === "no" || v === "off"
}

export async function probeParentOpenCode(baseUrl: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const url = normalizeParentOpenCodeUrl(baseUrl)
  const headers = new Headers(openCodeBasicAuthHeaders(env))
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
  const workspace = path.resolve(input.workspace)
  let bind: StudioBind
  try {
    bind = resolveStudioBind(input.parentOpenCodeUrl, env)
    assertNonLoopbackPassword(bind.hostname, env)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  // Reuse owned host; rebind domain root when the active OpenCode directory changes.
  if (state && state.bind.port === bind.port && state.bind.hostname === bind.hostname && (await studioHealthOk(state.bind.localUrl))) {
    if (state.workspace !== workspace) {
      try {
        await state.handle.rebindWorkspace(workspace)
        state.workspace = workspace
        console.error(`[opencode-studio] Studio workspace → ${workspace}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[opencode-studio] workspace rebind failed: ${message}`)
      }
    }
    return {
      ok: true,
      hostUrl: state.bind.localUrl,
      studioUrl: `${state.bind.localUrl}/studio`,
      reused: true,
      workspace: state.workspace,
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

  if (await studioHealthOk(bind.localUrl)) {
    // Another process (ensure-host companion) already owns :4173 — adopt and rebind via HTTP.
    try {
      await fetch(new URL("/api/workspace", `${bind.localUrl}/`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ workspace }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch {
      // host may reject; still usable at default workspace
    }
    return {
      ok: true,
      hostUrl: bind.localUrl,
      studioUrl: `${bind.localUrl}/studio`,
      reused: true,
      workspace,
    }
  }

  if (!(await probeParentOpenCode(parentUrl, env))) {
    return { ok: false, reason: `parent OpenCode not reachable at ${parentUrl}` }
  }

  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  try {
    const handle = await startHost({
      workspace,
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
      workspace,
    }
    return { ok: true, hostUrl: localUrl, studioUrl: `${localUrl}/studio`, reused: false, workspace }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: portBusyReason(bind.port, message) }
  }
}

/** Rebind the running host workspace (no-op if host not started). */
export async function rebindStudioHostWorkspace(workspace: string): Promise<boolean> {
  if (!state) return false
  const resolved = path.resolve(workspace)
  if (state.workspace === resolved) return true
  await state.handle.rebindWorkspace(resolved)
  state.workspace = resolved
  return true
}

export function getStudioHostWorkspace(): string | undefined {
  return state?.workspace
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
