import { existsSync, readFileSync } from "node:fs"
import { loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { checkNpmUpdate } from "./core/update-check"
import { STUDIO_HOST_PORT } from "./studio-host-bind"

export const PACKAGE_NAME = "@oguzkaganozt/opencode-studio"

/** Env keys copied from a running serve/host process when the upgrade CLI lacks them. */
const SNAPSHOT_ENV_KEYS = [
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_STUDIO_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
  "OPENCODE_STUDIO_USERNAME",
  "OPENCODE_HOSTNAME",
  "OPENCODE_SERVER_HOSTNAME",
  "OPENCODE_STUDIO_HOSTNAME",
  "OPENCODE_PORT",
  "OPENCODE_SERVER_PORT",
  "OPENCODE_STUDIO_PORT",
  "OPENCODE_STUDIO_BIND",
  "OPENCODE_STUDIO_AUTOSTART",
] as const

export type UpgradeOptions = {
  packageRoot?: string
  env?: NodeJS.ProcessEnv
  /** Progress lines (default: stderr). */
  onProgress?: (line: string) => void
}

export type StackSnapshot = {
  serveHostname?: string
  servePort?: string
  studioHostname?: string
  /** OPENCODE_* values from the running process environ (fill gaps only). */
  env: Record<string, string>
}

export async function checkPackageUpgrade(options: UpgradeOptions = {}) {
  const packageRoot = options.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const info = await checkNpmUpdate({ packageName: meta.name, current: meta.version })
  if (info.error && !info.latest) {
    return {
      action: "check" as const,
      packageName: meta.name,
      current: meta.version,
      latest: undefined as string | undefined,
      updateAvailable: false,
      error: info.error,
      message: `Could not check registry: ${info.error}`,
    }
  }
  if (info.updateAvailable && info.latest) {
    return {
      action: "check" as const,
      packageName: meta.name,
      current: meta.version,
      latest: info.latest,
      updateAvailable: true,
      message: info.message ?? `Update available: ${meta.version} → ${info.latest}. Run: opencode-studio upgrade`,
    }
  }
  return {
    action: "check" as const,
    packageName: meta.name,
    current: meta.version,
    latest: info.latest ?? meta.version,
    updateAvailable: false,
    message: `Up to date (${meta.version}).`,
  }
}

/** bun add -g @latest only (no restart). */
export async function upgradePackage(options: UpgradeOptions = {}): Promise<{
  action: "upgrade"
  packageName: string
  installOutput: string
  message: string
}> {
  const packageRoot = options.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const packageName = meta.name || PACKAGE_NAME
  const bun = Bun.which("bun")
  if (!bun) throw new Error("bun not found on PATH (required to install/upgrade opencode-studio)")
  const install = Bun.spawn([bun, "add", "-g", `${packageName}@latest`], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(install.stdout).text(), new Response(install.stderr).text(), install.exited])
  if (code !== 0) throw new Error(err.trim() || out.trim() || "bun add -g failed")
  const installOutput = (out.trim() || err.trim()).trim()
  return {
    action: "upgrade",
    packageName,
    installOutput,
    message: `Updated ${packageName}.`,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function logProgress(onProgress: ((line: string) => void) | undefined, line: string) {
  ;(onProgress ?? ((msg) => console.error(msg)))(line)
}

/** Parse `ps -eo pid=,args=` lines for `opencode serve` PIDs (never self). */
export function parseOpenCodeServePids(psOutput: string, selfPid = process.pid): number[] {
  const pids: number[] = []
  for (const raw of psOutput.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const space = line.search(/\s/)
    if (space <= 0) continue
    const pid = Number(line.slice(0, space))
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue
    const args = line.slice(space).trim()
    if (/(?:^|[/\s])opencode(?:\.exe)?\s+serve(?:\s|$)/.test(args)) pids.push(pid)
  }
  return pids
}

/** Parse `ss -tlnp` / `lsof` style `pid=123` tokens. */
export function parsePidsFromSs(ssOutput: string, selfPid = process.pid): number[] {
  const pids = new Set<number>()
  for (const match of ssOutput.matchAll(/pid=(\d+)/g)) {
    const pid = Number(match[1])
    if (Number.isInteger(pid) && pid > 0 && pid !== selfPid) pids.add(pid)
  }
  return [...pids]
}

/** Parse listen address for a TCP port from `ss -tlnp` output. */
export function parseListenHostPort(ssOutput: string, port: number): { hostname: string; port: string } | null {
  for (const line of ssOutput.split("\n")) {
    if (!line.includes("LISTEN")) continue
    // 0.0.0.0:4096  or 127.0.0.1:4096  or [::]:4096  or *:4096
    const match = line.match(new RegExp(`(?:^|\\s)(\\*|\\[::\\]|\\[::1\\]|[\\d.]+):${port}(?:\\s|$)`))
    if (!match) continue
    let host = match[1]!
    if (host === "*" || host === "[::]") host = "0.0.0.0"
    else if (host === "[::1]") host = "127.0.0.1"
    return { hostname: host, port: String(port) }
  }
  return null
}

/** Parse null-separated `/proc/pid/environ` bytes into OPENCODE_* keys we care about. */
export function parseProcEnviron(raw: string | Buffer): Record<string, string> {
  const text = typeof raw === "string" ? raw : raw.toString("utf8")
  const out: Record<string, string> = {}
  const want = new Set<string>(SNAPSHOT_ENV_KEYS)
  for (const entry of text.split("\0")) {
    if (!entry) continue
    const eq = entry.indexOf("=")
    if (eq <= 0) continue
    const key = entry.slice(0, eq)
    if (!want.has(key)) continue
    const value = entry.slice(eq + 1)
    if (value.length > 0) out[key] = value
  }
  return out
}

/**
 * Merge restart env: caller env wins on every set key; snapshot fills gaps
 * (bind + credentials from the previously running stack).
 */
export function mergeRestartEnv(
  callerEnv: NodeJS.ProcessEnv,
  snapshot: StackSnapshot | null,
): {
  env: NodeJS.ProcessEnv
  fromSnapshot: string[]
} {
  const env: NodeJS.ProcessEnv = { ...callerEnv }
  const fromSnapshot: string[] = []
  if (!snapshot) return { env, fromSnapshot }

  for (const [key, value] of Object.entries(snapshot.env)) {
    const current = env[key]?.trim()
    if (!current && value) {
      env[key] = value
      fromSnapshot.push(key)
    }
  }

  // Bind hosts from ss when caller did not set them.
  if (snapshot.serveHostname) {
    const hasHost = Boolean(env.OPENCODE_HOSTNAME?.trim() || env.OPENCODE_SERVER_HOSTNAME?.trim())
    if (!hasHost) {
      env.OPENCODE_HOSTNAME = snapshot.serveHostname
      fromSnapshot.push("OPENCODE_HOSTNAME")
    }
  }
  if (snapshot.servePort) {
    const hasPort = Boolean(env.OPENCODE_PORT?.trim() || env.OPENCODE_SERVER_PORT?.trim())
    if (!hasPort) {
      env.OPENCODE_PORT = snapshot.servePort
      fromSnapshot.push("OPENCODE_PORT")
    }
  }
  if (snapshot.studioHostname) {
    if (!env.OPENCODE_STUDIO_HOSTNAME?.trim()) {
      env.OPENCODE_STUDIO_HOSTNAME = snapshot.studioHostname
      fromSnapshot.push("OPENCODE_STUDIO_HOSTNAME")
    }
  }

  return { env, fromSnapshot }
}

async function signalPids(pids: number[], signal: NodeJS.Signals = "SIGTERM") {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

async function pidsMatching(pattern: RegExp, selfPid = process.pid): Promise<number[]> {
  const ps = Bun.spawn(["ps", "-eo", "pid=,args="], { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(ps.stdout).text()
  await ps.exited
  const pids: number[] = []
  for (const raw of out.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const space = line.search(/\s/)
    if (space <= 0) continue
    const pid = Number(line.slice(0, space))
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue
    if (pattern.test(line.slice(space).trim())) pids.push(pid)
  }
  return pids
}

async function readSs(): Promise<string> {
  const ss = Bun.spawn(["ss", "-tlnp"], { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(ss.stdout).text()
  await ss.exited
  return out
}

async function pidsOnPort(port: number, selfPid = process.pid): Promise<number[]> {
  const out = await readSs()
  const lines = out.split("\n").filter((line) => line.includes(`:${port} `) || line.endsWith(`:${port}`))
  return parsePidsFromSs(lines.join("\n"), selfPid)
}

function readProcEnviron(pid: number): Record<string, string> {
  try {
    return parseProcEnviron(readFileSync(`/proc/${pid}/environ`))
  } catch {
    return {}
  }
}

/** Capture bind + OPENCODE_* from the live stack before stop (gap-fill only). */
export async function captureStackSnapshot(selfPid = process.pid): Promise<StackSnapshot | null> {
  const ssOut = await readSs()
  const serveBind = parseListenHostPort(ssOut, 4096) ?? parseListenHostPort(ssOut, Number(process.env.OPENCODE_PORT) || 4096)
  const studioBind = parseListenHostPort(ssOut, STUDIO_HOST_PORT)

  const ps = Bun.spawn(["ps", "-eo", "pid=,args="], { stdout: "pipe", stderr: "pipe" })
  const psOut = await new Response(ps.stdout).text()
  await ps.exited
  const servePids = parseOpenCodeServePids(psOut, selfPid)
  const hostPids = [
    ...(await pidsMatching(/opencode-studio\s+ensure-host/, selfPid)),
    ...(await pidsMatching(/studio-host\.mjs/, selfPid)),
    ...parsePidsFromSs(
      ssOut
        .split("\n")
        .filter((line) => line.includes(`:${STUDIO_HOST_PORT} `) || line.endsWith(`:${STUDIO_HOST_PORT}`))
        .join("\n"),
      selfPid,
    ),
  ]

  const env: Record<string, string> = {}
  for (const pid of [...servePids, ...hostPids]) {
    for (const [key, value] of Object.entries(readProcEnviron(pid))) {
      if (!env[key] && value) env[key] = value
    }
  }

  let serveHostname = serveBind?.hostname
  let servePort = serveBind?.port
  for (const raw of psOut.split("\n")) {
    const line = raw.trim()
    if (!/(?:^|[/\s])opencode(?:\.exe)?\s+serve(?:\s|$)/.test(line)) continue
    const hostArg = line.match(/--hostname(?:=|\s+)(\S+)/)?.[1]
    const portArg = line.match(/--port(?:=|\s+)(\S+)/)?.[1]
    if (hostArg && !serveHostname) serveHostname = hostArg === "::" ? "0.0.0.0" : hostArg
    if (portArg && !servePort) servePort = portArg
  }

  if (!serveHostname && !studioBind && Object.keys(env).length === 0) return null

  return {
    serveHostname,
    servePort,
    studioHostname: studioBind?.hostname,
    env,
  }
}

/** Stop Studio host + ensure-host companions + `opencode serve`. Leaves interactive TUI sessions alone. */
export async function stopOpenCodeStudioStack(selfPid = process.pid): Promise<{ killed: number[] }> {
  const killed = new Set<number>()

  for (const pid of await pidsMatching(/opencode-studio\s+ensure-host/, selfPid)) killed.add(pid)
  for (const pid of await pidsMatching(/studio-host\.mjs/, selfPid)) killed.add(pid)
  for (const pid of await pidsOnPort(STUDIO_HOST_PORT, selfPid)) killed.add(pid)

  const ps = Bun.spawn(["ps", "-eo", "pid=,args="], { stdout: "pipe", stderr: "pipe" })
  const psOut = await new Response(ps.stdout).text()
  await ps.exited
  for (const pid of parseOpenCodeServePids(psOut, selfPid)) killed.add(pid)

  await signalPids([...killed], "SIGTERM")
  await sleep(800)
  for (const pid of await pidsOnPort(STUDIO_HOST_PORT, selfPid)) {
    killed.add(pid)
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // gone
    }
  }
  const psAgain = Bun.spawn(["ps", "-eo", "pid=,args="], { stdout: "pipe", stderr: "pipe" })
  const psAgainOut = await new Response(psAgain.stdout).text()
  await psAgain.exited
  for (const pid of parseOpenCodeServePids(psAgainOut, selfPid)) {
    killed.add(pid)
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // gone
    }
  }
  await sleep(200)
  return { killed: [...killed] }
}

async function waitHttpOk(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(1_500) })
      if (response.ok) return true
    } catch {
      // retry
    }
    await sleep(400)
  }
  return false
}

function resolveServeBind(env: NodeJS.ProcessEnv): { hostname: string; port: string } {
  const password = env.OPENCODE_STUDIO_PASSWORD?.trim() || env.OPENCODE_SERVER_PASSWORD?.trim()
  const hostname = env.OPENCODE_HOSTNAME?.trim() || env.OPENCODE_SERVER_HOSTNAME?.trim() || (password ? "0.0.0.0" : "127.0.0.1")
  const port = env.OPENCODE_PORT?.trim() || env.OPENCODE_SERVER_PORT?.trim() || "4096"
  return { hostname, port }
}

function resolveOpencodeBin(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME?.trim()
  if (home) {
    const wrapper = `${home}/.local/bin/opencode`
    if (existsSync(wrapper)) return wrapper
  }
  const onPath = Bun.which("opencode")
  if (!onPath) throw new Error("opencode not found on PATH (needed to restart serve after upgrade)")
  return onPath
}

/** Detached `opencode serve` (wrapper starts ensure-host). Waits for Studio health. */
export async function startOpenCodeStudioStack(
  env: NodeJS.ProcessEnv = process.env,
  onProgress?: (line: string) => void,
): Promise<{
  serveUrl: string
  studioUrl: string
  hostname: string
  port: string
}> {
  const { hostname, port } = resolveServeBind(env)
  const password = env.OPENCODE_STUDIO_PASSWORD?.trim() || env.OPENCODE_SERVER_PASSWORD?.trim()
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    OPENCODE_STUDIO_AUTOSTART: "1",
  }
  if (password) {
    if (!childEnv.OPENCODE_SERVER_PASSWORD) childEnv.OPENCODE_SERVER_PASSWORD = password
    if (!childEnv.OPENCODE_STUDIO_PASSWORD) childEnv.OPENCODE_STUDIO_PASSWORD = password
    if (!childEnv.OPENCODE_SERVER_USERNAME && !childEnv.OPENCODE_STUDIO_USERNAME) {
      childEnv.OPENCODE_SERVER_USERNAME = "opencode"
      childEnv.OPENCODE_STUDIO_USERNAME = "opencode"
    }
    if (!childEnv.OPENCODE_STUDIO_HOSTNAME && (hostname === "0.0.0.0" || hostname === "::")) {
      childEnv.OPENCODE_STUDIO_HOSTNAME = "0.0.0.0"
    }
  }

  if ((hostname === "0.0.0.0" || hostname === "::") && !password) {
    throw new Error(
      "Refusing non-loopback restart without OPENCODE_SERVER_PASSWORD or OPENCODE_STUDIO_PASSWORD (set env or keep the previous stack credentials).",
    )
  }

  logProgress(onProgress, `Starting opencode serve on ${hostname}:${port}…`)
  const opencode = resolveOpencodeBin(env)
  const logPath = `${env.TMPDIR?.trim() || "/tmp"}/opencode-studio-upgrade-serve.log`
  const log = Bun.file(logPath)
  const child = Bun.spawn([opencode, "serve", "--hostname", hostname, "--port", port], {
    env: childEnv,
    cwd: env.HOME?.trim() || process.cwd(),
    stdin: "ignore",
    stdout: log,
    stderr: log,
    detached: true,
  })
  child.unref()

  const studioHealth = `http://127.0.0.1:${STUDIO_HOST_PORT}/studio-api/health`
  logProgress(onProgress, "Waiting for Studio host…")
  const ok = await waitHttpOk(studioHealth, 45_000)
  if (!ok) {
    throw new Error(
      `Studio host did not become ready at ${studioHealth} within 45s (serve log: ${logPath}). Check OPENCODE_* / OPENCODE_STUDIO_* bind and password env.`,
    )
  }
  logProgress(onProgress, "Studio host ready.")
  return {
    serveUrl: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`,
    studioUrl: `http://127.0.0.1:${STUDIO_HOST_PORT}/studio`,
    hostname,
    port,
  }
}

async function runNewCliRepair(env: NodeJS.ProcessEnv, onProgress?: (line: string) => void): Promise<string> {
  const cli = Bun.which("opencode-studio")
  if (!cli) throw new Error("opencode-studio not on PATH after install")
  logProgress(onProgress, "Running repair (plugins, skills, MCP)…")
  const proc = Bun.spawn([cli, "repair"], { stdout: "pipe", stderr: "pipe", env })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(err.trim() || out.trim() || "opencode-studio repair failed after upgrade")
  logProgress(onProgress, "Repair done.")
  return (out.trim() || err.trim()).trim()
}

/**
 * Snapshot → stop stack → bun add -g @latest → repair (new CLI) → start serve + host.
 * Caller env wins; snapshot fills missing bind/credentials from the previous stack.
 */
export async function upgradeAndRestart(options: UpgradeOptions = {}): Promise<{
  action: "upgrade"
  packageName: string
  current: string
  latest: string
  killed: number[]
  installOutput: string
  repairOutput: string
  serveUrl: string
  studioUrl: string
  snapshotUsed: string[]
  message: string
}> {
  const onProgress = options.onProgress
  const callerEnv = options.env ?? process.env
  const packageRoot = options.packageRoot ?? packageRootFrom(import.meta.dir)
  const before = await checkPackageUpgrade({ packageRoot })
  if (!before.updateAvailable || !before.latest) {
    throw new Error(before.message)
  }

  logProgress(onProgress, `Update ${before.current} → ${before.latest}`)
  logProgress(onProgress, "Capturing running stack (bind/credentials)…")
  const snapshot = await captureStackSnapshot()
  const { env, fromSnapshot } = mergeRestartEnv(callerEnv, snapshot)
  if (fromSnapshot.length > 0) {
    const safe = fromSnapshot.filter((k) => !/PASSWORD/i.test(k))
    const secrets = fromSnapshot.filter((k) => /PASSWORD/i.test(k)).length
    logProgress(
      onProgress,
      `Restored from previous stack: ${[...safe, secrets > 0 ? `(${secrets} secret${secrets === 1 ? "" : "s"})` : ""].filter(Boolean).join(", ")}`,
    )
  } else if (snapshot) {
    logProgress(onProgress, "Previous stack found; caller env already complete.")
  } else {
    logProgress(onProgress, "No previous stack snapshot (using caller env / defaults).")
  }

  logProgress(onProgress, "Stopping opencode serve and Studio host…")
  const { killed } = await stopOpenCodeStudioStack()
  logProgress(onProgress, `Stopped ${killed.length} process(es).`)

  logProgress(onProgress, "Installing package (bun add -g @latest)…")
  const upgraded = await upgradePackage({ packageRoot })
  logProgress(onProgress, upgraded.installOutput ? `Installed.\n${upgraded.installOutput}` : "Installed.")

  const repairOutput = await runNewCliRepair(env, onProgress)
  const started = await startOpenCodeStudioStack(env, onProgress)

  const bindNote =
    started.hostname === "127.0.0.1" || started.hostname === "localhost"
      ? "Bound loopback only (set OPENCODE_SERVER_PASSWORD + OPENCODE_HOSTNAME=0.0.0.0 for online)."
      : `Bound ${started.hostname}:${started.port} (online).`

  logProgress(onProgress, "Upgrade complete.")

  return {
    action: "upgrade",
    packageName: upgraded.packageName,
    current: before.current,
    latest: before.latest,
    killed,
    installOutput: upgraded.installOutput,
    repairOutput,
    serveUrl: started.serveUrl,
    studioUrl: started.studioUrl,
    snapshotUsed: fromSnapshot,
    message: [
      `Upgraded ${upgraded.packageName} ${before.current} → ${before.latest}.`,
      `Stopped ${killed.length} process(es).`,
      bindNote,
      started.serveUrl ? `OpenCode: ${started.serveUrl}` : "",
      `Studio:  ${started.studioUrl}`,
    ]
      .filter(Boolean)
      .join("\n"),
  }
}
