import { existsSync } from "node:fs"
import { loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { checkNpmUpdate } from "./core/update-check"
import { STUDIO_HOST_PORT } from "./studio-host-bind"

export const PACKAGE_NAME = "@oguzkaganozt/opencode-studio"

export type UpgradeOptions = {
  packageRoot?: string
  env?: NodeJS.ProcessEnv
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
    // Real binary or wrapper: ".../opencode serve ..." or "opencode serve ..."
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

async function pidsOnPort(port: number, selfPid = process.pid): Promise<number[]> {
  const ss = Bun.spawn(["ss", "-tlnp"], { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(ss.stdout).text()
  await ss.exited
  const lines = out.split("\n").filter((line) => line.includes(`:${port} `) || line.endsWith(`:${port}`))
  return parsePidsFromSs(lines.join("\n"), selfPid)
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
  // stubborn listeners on studio port
  for (const pid of await pidsOnPort(STUDIO_HOST_PORT, selfPid)) {
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
export async function startOpenCodeStudioStack(env: NodeJS.ProcessEnv = process.env): Promise<{
  serveUrl: string
  studioUrl: string
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
  const ok = await waitHttpOk(studioHealth, 45_000)
  if (!ok) {
    throw new Error(
      `Studio host did not become ready at ${studioHealth} within 45s (serve log: ${logPath}). Check OPENCODE_* / OPENCODE_STUDIO_* bind and password env.`,
    )
  }
  return {
    serveUrl: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`,
    studioUrl: `http://127.0.0.1:${STUDIO_HOST_PORT}/studio`,
  }
}

async function runNewCliRepair(env: NodeJS.ProcessEnv): Promise<string> {
  const cli = Bun.which("opencode-studio")
  if (!cli) throw new Error("opencode-studio not on PATH after install")
  const proc = Bun.spawn([cli, "repair"], { stdout: "pipe", stderr: "pipe", env })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(err.trim() || out.trim() || "opencode-studio repair failed after upgrade")
  return (out.trim() || err.trim()).trim()
}

/**
 * Stop stack → bun add -g @latest → repair (new CLI) → start serve + host.
 * Caller handles confirm / --yes.
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
  message: string
}> {
  const env = options.env ?? process.env
  const packageRoot = options.packageRoot ?? packageRootFrom(import.meta.dir)
  const before = await checkPackageUpgrade({ packageRoot })
  if (!before.updateAvailable || !before.latest) {
    throw new Error(before.message)
  }

  const { killed } = await stopOpenCodeStudioStack()
  const upgraded = await upgradePackage({ packageRoot })
  const repairOutput = await runNewCliRepair(env)
  const started = await startOpenCodeStudioStack(env)

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
    message: [
      `Upgraded ${upgraded.packageName} ${before.current} → ${before.latest}.`,
      `Stopped ${killed.length} process(es).`,
      started.serveUrl ? `OpenCode: ${started.serveUrl}` : "",
      `Studio:  ${started.studioUrl}`,
    ]
      .filter(Boolean)
      .join("\n"),
  }
}
