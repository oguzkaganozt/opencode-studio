import path from "node:path"
import { packageRootFrom } from "./core/paths"
import { normalizeParentOpenCodeUrl } from "./opencode-bridge"
import { type HostHandle, startHost } from "./server"

export const STUDIO_HOST_PORT = 4173
export const DEFAULT_STUDIO_HOST_URL = `http://127.0.0.1:${STUDIO_HOST_PORT}`

export type EnsureStudioHostInput = {
  parentOpenCodeUrl: string
  workspace: string
  packageRoot?: string
  uiDirectory?: string
  env?: NodeJS.ProcessEnv
  /** Skip ensure when set to "0" / "false" / "no". */
  autostart?: string
}

export type EnsureStudioHostResult = { ok: true; hostUrl: string; studioUrl: string; reused: boolean } | { ok: false; reason: string }

type HostState = {
  workspace: string
  parentUrl: string
  handle: HostHandle
}

let state: HostState | undefined
let starting: Promise<EnsureStudioHostResult> | undefined

function autostartDisabled(value: string | undefined) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off"
}

export async function probeParentOpenCode(baseUrl: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const url = normalizeParentOpenCodeUrl(baseUrl)
  const headers = new Headers()
  const password = env.OPENCODE_SERVER_PASSWORD
  if (password) {
    const username = env.OPENCODE_SERVER_USERNAME || "opencode"
    headers.set("Authorization", `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_000)
  try {
    const response = await fetch(new URL("/global/health", `${url}/`), {
      headers,
      signal: controller.signal,
    })
    if (response.ok) return true
    // Some builds expose a different health path; only accept 2xx.
    const alt = await fetch(new URL("/", `${url}/`), { headers, signal: controller.signal }).catch(() => null)
    return Boolean(alt?.ok)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function studioHealthOk(hostUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/studio-api/health", `${hostUrl}/`), { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * In-process singleton Studio host attached to a parent OpenCode server.
 * First workspace wins for the process lifetime. Does not stop on plugin dispose.
 */
export async function ensureStudioHost(input: EnsureStudioHostInput): Promise<EnsureStudioHostResult> {
  const env = input.env ?? process.env
  if (autostartDisabled(input.autostart ?? env.OPENCODE_STUDIO_AUTOSTART)) {
    return { ok: false, reason: "OPENCODE_STUDIO_AUTOSTART disabled" }
  }

  if (starting) return starting
  starting = (async () => {
    try {
      return await ensureStudioHostLocked(input, env)
    } finally {
      starting = undefined
    }
  })()
  return starting
}

async function ensureStudioHostLocked(input: EnsureStudioHostInput, env: NodeJS.ProcessEnv): Promise<EnsureStudioHostResult> {
  const parentUrl = normalizeParentOpenCodeUrl(input.parentOpenCodeUrl)
  const hostUrl = DEFAULT_STUDIO_HOST_URL

  if (state) {
    if (await studioHealthOk(hostUrl)) {
      return { ok: true, hostUrl, studioUrl: `${hostUrl}/studio`, reused: true }
    }
    try {
      state.handle.stop()
    } catch {
      // continue and restart
    }
    state = undefined
  }

  if (await studioHealthOk(hostUrl)) {
    return { ok: true, hostUrl, studioUrl: `${hostUrl}/studio`, reused: true }
  }

  const parentOk = await probeParentOpenCode(parentUrl, env)
  if (!parentOk) {
    return { ok: false, reason: `parent OpenCode not reachable at ${parentUrl}` }
  }

  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const uiDirectory = input.uiDirectory ?? path.join(packageRoot, "dist", "ui")

  try {
    const handle = await startHost({
      workspace: input.workspace,
      parentOpenCodeUrl: parentUrl,
      hostname: "127.0.0.1",
      port: STUDIO_HOST_PORT,
      packageRoot,
      uiDirectory,
      env,
      handleSignals: false,
    })
    state = { workspace: input.workspace, parentUrl, handle }
    return { ok: true, hostUrl: handle.url.replace(/\/$/, ""), studioUrl: handle.studioUrl, reused: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: message }
  }
}

/** Test helper: drop in-process singleton (does not kill foreign :4173). */
export function resetStudioHostEnsureForTests() {
  try {
    state?.handle.stop()
  } catch {
    // ignore
  }
  state = undefined
  starting = undefined
}
