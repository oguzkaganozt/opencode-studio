import { type ChildProcess, spawn } from "node:child_process"
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs"
import path from "node:path"
import { normalizeParentOpenCodeUrl, openCodeBasicAuthHeaders } from "./opencode-bridge"
import { resolveStudioBind } from "./studio-host-bind"

export type SuperviseResult = { ok: true; baseUrl: string; spawned: boolean; pid?: number } | { ok: false; reason: string }

export type SupervisorStatus = {
  /** True when this host spawned OpenCode and should keep it alive. */
  supervised: boolean
  pid?: number
  baseUrl?: string
  restartsInWindow: number
}

type OwnedState = {
  child: ChildProcess
  baseUrl: string
  port: number
  log: WriteStream
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>
  logClosed: boolean
}

const WATCH_MS = 5_000
const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 5 * 60_000

let owned: OwnedState | undefined
/** Once we spawn, keep supervising until permanent stop. */
let ownSupervision = false
let watchEnv: NodeJS.ProcessEnv = process.env
let watchdogTimer: ReturnType<typeof setInterval> | undefined
let restartTimestamps: number[] = []
let restartFlight: Promise<SuperviseResult> | undefined
let supervisionGeneration = 0

function envFlag(value: string | undefined) {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

export function superviseDisabled(env: NodeJS.ProcessEnv = process.env) {
  return envFlag(env.OPENCODE_STUDIO_NO_SUPERVISE)
}

async function healthOk(baseUrl: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const url = normalizeParentOpenCodeUrl(baseUrl)
  try {
    const response = await fetch(new URL("/global/health", `${url}/`), {
      headers: openCodeBasicAuthHeaders(env),
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok
  } catch {
    return false
  }
}

function resolveBinary(env: NodeJS.ProcessEnv): string {
  return env.OPENCODE_BIN?.trim() || "opencode"
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.OPENCODE_PORT?.trim() || env.OPENCODE_SERVER_PORT?.trim()
  if (raw && /^\d+$/.test(raw)) return Number(raw)
  return 4096
}

function logPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CACHE_HOME?.trim() || path.join(env.HOME || "/tmp", ".cache")
  const dir = path.join(base, "opencode-studio")
  mkdirSync(dir, { recursive: true })
  return path.join(dir, "opencode-serve.log")
}

export function supervisedChildEnv(baseUrl: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    OPENCODE_STUDIO_AUTOSTART: "0",
    OPENCODE_STUDIO_URL: env.OPENCODE_STUDIO_URL?.trim() || resolveStudioBind(baseUrl, env).localUrl,
  }
}

function pruneRestarts(now = Date.now()) {
  restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
}

function canRestart(): boolean {
  pruneRestarts()
  return restartTimestamps.length < MAX_RESTARTS
}

function noteRestart() {
  restartTimestamps.push(Date.now())
}

export function supervisorStatus(): SupervisorStatus {
  pruneRestarts()
  return {
    supervised: ownSupervision,
    pid: owned?.child.pid,
    baseUrl: owned?.baseUrl,
    restartsInWindow: restartTimestamps.length,
  }
}

function clearWatchdog() {
  if (watchdogTimer !== undefined) {
    clearInterval(watchdogTimer)
    watchdogTimer = undefined
  }
}

async function tickWatchdog() {
  if (!ownSupervision) return
  if (owned && (await healthOk(owned.baseUrl, watchEnv))) return
  console.error("[opencode-studio] OpenCode unhealthy or exited; restarting…")
  const result = await restartOpenCode(watchEnv)
  if (!result.ok) {
    console.error(`[opencode-studio] OpenCode restart failed: ${result.reason}`)
  } else {
    console.error(`[opencode-studio] OpenCode restarted at ${result.baseUrl} (pid ${result.pid ?? "?"})`)
  }
}

/** Periodic health loop for a server this process spawned. Safe to call repeatedly. */
export function startOpenCodeWatchdog(env: NodeJS.ProcessEnv = process.env) {
  watchEnv = env
  if (!ownSupervision) return
  clearWatchdog()
  watchdogTimer = setInterval(() => {
    void tickWatchdog()
  }, WATCH_MS)
}

export function stopOpenCodeWatchdog() {
  clearWatchdog()
}

function closeLog(state: OwnedState) {
  if (state.logClosed) return
  state.logClosed = true
  state.child.stdout?.unpipe(state.log)
  state.child.stderr?.unpipe(state.log)
  state.log.end()
}

async function waitForClose(state: OwnedState, timeoutMs: number) {
  return Promise.race([state.closed.then(() => true), Bun.sleep(timeoutMs).then(() => false)])
}

async function terminateOwnedState(state: OwnedState) {
  if (owned === state) owned = undefined
  try {
    if (state.child.exitCode === null && !state.child.killed) state.child.kill("SIGTERM")
  } catch {
    // already gone
  }
  if (!(await waitForClose(state, 2_000))) {
    try {
      state.child.kill("SIGKILL")
    } catch {
      // already gone
    }
    await waitForClose(state, 1_000)
  }
  closeLog(state)
}

async function killOwnedChild() {
  const state = owned
  if (state) await terminateOwnedState(state)
}

async function spawnOpenCode(env: NodeJS.ProcessEnv): Promise<SuperviseResult> {
  const port = resolvePort(env)
  const hostname = "127.0.0.1"
  const baseUrl = `http://${hostname}:${port}`
  const bin = resolveBinary(env)
  const args = ["serve", "--hostname", hostname, "--port", String(port)]
  const outPath = logPath(env)
  const out = createWriteStream(outPath, { flags: "a" })
  out.write(`\n--- ${new Date().toISOString()} spawn ${bin} ${args.join(" ")}\n`)

  let child: ChildProcess
  try {
    child = spawn(bin, args, {
      env: supervisedChildEnv(baseUrl, env),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  let settle: ((value: { code: number | null; signal: NodeJS.Signals | null; error?: Error }) => void) | undefined
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
    settle = resolve
  })
  let settled = false
  const finish = (value: { code: number | null; signal: NodeJS.Signals | null; error?: Error }) => {
    if (settled) return
    settled = true
    settle?.(value)
  }
  child.once("error", (error) => finish({ code: null, signal: null, error }))
  child.once("close", (code, signal) => finish({ code, signal }))

  const state: OwnedState = { child, baseUrl, port, log: out, closed, logClosed: false }
  owned = state
  child.stdout?.pipe(out, { end: false })
  child.stderr?.pipe(out, { end: false })
  void closed.then(() => {
    if (owned === state) owned = undefined
    closeLog(state)
  })

  const deadline = Date.now() + 20_000
  let terminal: Awaited<typeof closed> | undefined
  void closed.then((value) => {
    terminal = value
  })
  while (Date.now() < deadline) {
    if (terminal) {
      await terminateOwnedState(state)
      const detail = terminal.error?.message || `code ${terminal.code}${terminal.signal ? `, signal ${terminal.signal}` : ""}`
      return { ok: false, reason: `opencode serve exited early (${detail}); see ${outPath}` }
    }
    if (await healthOk(baseUrl, env)) {
      ownSupervision = true
      return { ok: true, baseUrl, spawned: true, pid: child.pid }
    }
    await Bun.sleep(300)
  }

  await terminateOwnedState(state)
  return { ok: false, reason: `opencode serve did not become healthy at ${baseUrl}; see ${outPath}` }
}

/** Prefer existing OpenCode; otherwise spawn `opencode serve` on loopback. */
export async function ensureOpenCodeServer(env: NodeJS.ProcessEnv = process.env): Promise<SuperviseResult> {
  watchEnv = env
  if (superviseDisabled(env)) {
    const explicit = env.OPENCODE_URL?.trim()
    if (explicit) {
      const baseUrl = normalizeParentOpenCodeUrl(explicit)
      if (await healthOk(baseUrl, env)) return { ok: true, baseUrl, spawned: false }
      return { ok: false, reason: `OPENCODE_URL not healthy: ${baseUrl}` }
    }
    return { ok: false, reason: "OPENCODE_STUDIO_NO_SUPERVISE set and no OPENCODE_URL" }
  }

  const explicit = env.OPENCODE_URL?.trim() || env.OPENCODE_PARENT_URL?.trim()
  if (explicit) {
    const baseUrl = normalizeParentOpenCodeUrl(explicit)
    if (await healthOk(baseUrl, env)) return { ok: true, baseUrl, spawned: false }
    if (env.OPENCODE_URL?.trim()) return { ok: false, reason: `OPENCODE_URL not healthy: ${baseUrl}` }
  }

  for (const candidate of [`http://127.0.0.1:${resolvePort(env)}`]) {
    if (await healthOk(candidate, env)) {
      return { ok: true, baseUrl: normalizeParentOpenCodeUrl(candidate), spawned: false }
    }
  }

  if (owned?.child && !owned.child.killed) {
    if (await healthOk(owned.baseUrl, env)) return { ok: true, baseUrl: owned.baseUrl, spawned: true, pid: owned.child.pid }
    await killOwnedChild()
  }

  const result = await spawnOpenCode(env)
  if (result.ok && result.spawned) startOpenCodeWatchdog(env)
  return result
}

/**
 * Kill supervised OpenCode and spawn again. Fails if this host only attached to an external process.
 */
export async function restartOwnedOpenCode(env: NodeJS.ProcessEnv = process.env): Promise<SuperviseResult> {
  watchEnv = env
  if (!ownSupervision && !owned) {
    return { ok: false, reason: "OpenCode is not supervised by this host (attached external process)" }
  }
  return restartOpenCode(env)
}

async function restartOpenCode(env: NodeJS.ProcessEnv): Promise<SuperviseResult> {
  if (restartFlight) return restartFlight
  if (!canRestart()) return { ok: false, reason: "OpenCode restart budget exhausted (5 / 5min)" }
  noteRestart()
  const generation = supervisionGeneration
  const flight: Promise<SuperviseResult> = (async () => {
    await killOwnedChild()
    if (!ownSupervision || generation !== supervisionGeneration) return { ok: false as const, reason: "OpenCode supervision stopped" }
    const result = await spawnOpenCode(env)
    if (result.ok && result.spawned) startOpenCodeWatchdog(env)
    return result
  })()
  restartFlight = flight.finally(() => {
    restartFlight = undefined
  })
  return restartFlight
}

/** Stop only a server this supervisor started. Pass permanent to drop supervision. */
export async function stopOwnedOpenCode(options?: { permanent?: boolean }): Promise<void> {
  if (options?.permanent) {
    supervisionGeneration += 1
    ownSupervision = false
    stopOpenCodeWatchdog()
  }
  await killOwnedChild()
  if (restartFlight) await restartFlight.catch(() => {})
  await killOwnedChild()
}

export function ownedOpenCodeBaseUrl(): string | undefined {
  return owned?.baseUrl
}

export async function resetOpenCodeSupervisorForTests() {
  ownSupervision = false
  supervisionGeneration += 1
  restartTimestamps = []
  stopOpenCodeWatchdog()
  await killOwnedChild()
}
