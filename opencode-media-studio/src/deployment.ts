import { randomUUID } from "node:crypto"
import {
  lstat as fsLstat,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readlink as fsReadlink,
  realpath as fsRealpath,
  rename as fsRename,
  rm as fsRm,
  symlink as fsSymlink,
  writeFile as fsWriteFile,
} from "node:fs/promises"
import { homedir as osHomedir, userInfo } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import manifest from "../package.json" with { type: "json" }
import { compareVersions } from "./version"

export const SERVICE_NAME = "opencode-media-studio"
export const SYSTEM_INSTALL_ROOT = "/opt/opencode-media-studio"
const PACKAGE_NAME = manifest.name
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export type DeploymentScope = "system" | "user"

type CommandResult = { exitCode: number; stdout: string; stderr: string }

export type DeploymentDependencies = {
  log?: (message: string) => void
  warn?: (message: string) => void
  getuid?: () => number
  homedir?: () => string
  bunPath?: string
  runCommand?: (command: string, args: string[]) => Promise<CommandResult>
  mkdir?: typeof fsMkdir
  writeFile?: typeof fsWriteFile
  readFile?: typeof fsReadFile
  lstat?: typeof fsLstat
  realpath?: typeof fsRealpath
  readlink?: typeof fsReadlink
  rename?: typeof fsRename
  symlink?: typeof fsSymlink
  rm?: typeof fsRm
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  sleep?: (milliseconds: number) => Promise<void>
  username?: () => string
  now?: () => number
  processAlive?: (pid: number) => boolean
}

function safeSystemdValue(value: string, label: string) {
  if (!value || /[\0\r\n]/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function systemdQuote(value: string, label: string) {
  return `"${safeSystemdValue(value, label).replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function safeAccount(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function validVersion(value: string) {
  if (!VERSION_PATTERN.test(value)) throw new Error(`Invalid package version: ${value}`)
  return value
}

function currentScope(getuid: () => number): DeploymentScope {
  return getuid() === 0 ? "system" : "user"
}

export function deploymentPaths(scope: DeploymentScope, home: string, installRoot?: string) {
  const root = path.resolve(
    installRoot ?? (scope === "system" ? SYSTEM_INSTALL_ROOT : path.join(home, ".local/share/opencode-media-studio/app")),
  )
  const current = path.join(root, "current")
  const packageRoot = path.join(current, "node_modules", PACKAGE_NAME)
  return {
    root,
    releases: path.join(root, "releases"),
    current,
    packageRoot,
    cliPath: path.join(packageRoot, "dist", "cli.js"),
    pluginPath: path.join(packageRoot, "dist", "plugin.js"),
    providerPath: path.join(packageRoot, "dist", "provider.js"),
    launcherPath: path.join(scope === "system" ? "/usr/local/bin" : path.join(home, ".local/bin"), SERVICE_NAME),
    lockPath: path.join(root, ".update-lock"),
  }
}

export function generateSystemdUnit(input: {
  scope: DeploymentScope
  libraryRoot: string
  installRoot: string
  host: string
  port: number
  bunPath: string
  serviceUser?: string
  serviceGroup?: string
}) {
  const paths = deploymentPaths(input.scope, osHomedir(), input.installRoot)
  const lines = [
    "[Unit]",
    "Description=OpenCode Media Studio companion",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
  ]
  if (input.scope === "system") {
    lines.push(
      `User=${safeAccount(input.serviceUser ?? "opencode-companion", "service user")}`,
      `Group=${safeAccount(input.serviceGroup ?? "opencode-media", "service group")}`,
      `WorkingDirectory=${systemdQuote(input.libraryRoot, "Library root")}`,
    )
  }
  lines.push(
    `Environment=${systemdQuote(`OPENCODE_MEDIA_STUDIO_INSTALL_ROOT=${paths.root}`, "install root")}`,
    `Environment=${systemdQuote(`OPENCODE_MEDIA_STUDIO_INSTALL_SCOPE=${input.scope}`, "install scope")}`,
    `ExecStart=${systemdQuote(input.bunPath, "Bun path")} ${systemdQuote(paths.cliPath, "CLI path")} serve --root ${systemdQuote(input.libraryRoot, "Library root")} --host ${systemdQuote(input.host, "host")} --port ${input.port}`,
    "Restart=on-failure",
    "RestartSec=5",
  )
  if (input.scope === "system") {
    lines.push(
      "NoNewPrivileges=true",
      "ProtectSystem=strict",
      "ProtectHome=true",
      "PrivateTmp=true",
      `ReadWritePaths=${systemdQuote(input.libraryRoot, "Library root")}`,
      "AmbientCapabilities=",
      "CapabilityBoundingSet=",
    )
  }
  lines.push("", "[Install]", `WantedBy=${input.scope === "system" ? "multi-user.target" : "default.target"}`, "")
  return lines.join("\n")
}

function defaultRunCommand(command: string, args: string[]): Promise<CommandResult> {
  const subprocess = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
  return Promise.all([subprocess.exited, new Response(subprocess.stdout).text(), new Response(subprocess.stderr).text()]).then(
    ([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }),
  )
}

function operations(dependencies: DeploymentDependencies) {
  return {
    log: dependencies.log ?? console.log,
    warn: dependencies.warn ?? console.warn,
    getuid: dependencies.getuid ?? (() => process.getuid?.() ?? 0),
    homedir: dependencies.homedir ?? osHomedir,
    runCommand: dependencies.runCommand ?? defaultRunCommand,
    mkdir: dependencies.mkdir ?? fsMkdir,
    writeFile: dependencies.writeFile ?? fsWriteFile,
    readFile: dependencies.readFile ?? fsReadFile,
    lstat: dependencies.lstat ?? fsLstat,
    realpath: dependencies.realpath ?? fsRealpath,
    readlink: dependencies.readlink ?? fsReadlink,
    rename: dependencies.rename ?? fsRename,
    symlink: dependencies.symlink ?? fsSymlink,
    rm: dependencies.rm ?? fsRm,
    fetcher: dependencies.fetcher ?? fetch,
    sleep: dependencies.sleep ?? Bun.sleep,
    username: dependencies.username ?? (() => userInfo().username),
    now: dependencies.now ?? Date.now,
    processAlive:
      dependencies.processAlive ??
      ((pid: number) => {
        try {
          process.kill(pid, 0)
          return true
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "EPERM"
        }
      }),
  }
}

async function acquireLock(lockPath: string, ops: ReturnType<typeof operations>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ops.mkdir(lockPath)
      try {
        await ops.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: ops.now() }), { mode: 0o600 })
      } catch (error) {
        await ops.rm(lockPath, { recursive: true, force: true })
        throw error
      }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      let stale = false
      try {
        const owner = JSON.parse(await ops.readFile(path.join(lockPath, "owner.json"), "utf8")) as {
          pid?: unknown
          startedAt?: unknown
        }
        stale =
          typeof owner.pid === "number" &&
          typeof owner.startedAt === "number" &&
          ops.now() - owner.startedAt >= 0 &&
          (!ops.processAlive(owner.pid) || ops.now() - owner.startedAt > 6 * 60 * 60 * 1000)
      } catch {
        const info = await ops.lstat(lockPath)
        stale = ops.now() - info.mtimeMs > 5 * 60 * 1000
      }
      if (!stale || attempt > 0) throw new Error("Another OpenCode Media Studio install or update is running")
      await ops.rm(lockPath, { recursive: true, force: true })
    }
  }
  throw new Error("Could not acquire the OpenCode Media Studio update lock")
}

async function optionalReadlink(filePath: string, readlink: typeof fsReadlink) {
  try {
    return await readlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EINVAL") return
    throw error
  }
}

async function optionalReadFile(filePath: string, readFile: typeof fsReadFile) {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}

async function writeAtomic(filePath: string, content: string, mode: number, ops: ReturnType<typeof operations>) {
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    await ops.writeFile(temporary, content, { mode })
    await ops.rename(temporary, filePath)
  } finally {
    await ops.rm(temporary, { force: true }).catch(() => {})
  }
}

async function validateRelease(input: {
  releaseRoot: string
  version: string
  readFile: typeof fsReadFile
  lstat: typeof fsLstat
  realpath: typeof fsRealpath
}) {
  const packageRoot = path.join(input.releaseRoot, "node_modules", PACKAGE_NAME)
  const packageInfo = JSON.parse(await input.readFile(path.join(packageRoot, "package.json"), "utf8")) as {
    name?: string
    version?: string
    dependencies?: Record<string, unknown>
  }
  if (packageInfo.name !== PACKAGE_NAME || packageInfo.version !== input.version)
    throw new Error("Installed package manifest does not match the requested version")
  for (const required of ["dist/cli.js", "dist/plugin.js", "dist/provider.js", "dist/ui/index.html"]) {
    const filePath = path.join(packageRoot, required)
    const info = await input.lstat(filePath)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Installed package is missing a regular ${required}`)
    const canonical = await input.realpath(filePath)
    if (!canonical.startsWith(`${await input.realpath(input.releaseRoot)}${path.sep}`))
      throw new Error(`Installed package escapes the release root: ${required}`)
  }
  if (!packageInfo.dependencies || typeof packageInfo.dependencies !== "object")
    throw new Error("Installed package has no runtime dependencies")
  for (const dependency of Object.keys(packageInfo.dependencies)) {
    const dependencyManifest = path.join(input.releaseRoot, "node_modules", dependency, "package.json")
    const info = await input.lstat(dependencyManifest)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Installed package is missing runtime dependency ${dependency}`)
  }
}

async function stageRelease(input: { root: string; version: string; ops: ReturnType<typeof operations> }) {
  const releaseRoot = path.join(input.root, "releases", input.version)
  try {
    const info = await input.ops.lstat(releaseRoot)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe existing release directory: ${releaseRoot}`)
    await validateRelease({ releaseRoot, version: input.version, ...input.ops })
    return releaseRoot
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const staging = path.join(input.root, "releases", `.${input.version}-${randomUUID()}`)
  await input.ops.mkdir(staging, { recursive: false, mode: 0o755 })
  try {
    const installed = await input.ops.runCommand("npm", [
      "install",
      "--prefix",
      staging,
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${PACKAGE_NAME}@${input.version}`,
    ])
    if (installed.exitCode !== 0) throw new Error(`npm install failed: ${installed.stderr.trim() || installed.stdout.trim()}`)
    await validateRelease({ releaseRoot: staging, version: input.version, ...input.ops })
    await input.ops.rename(staging, releaseRoot)
    return releaseRoot
  } catch (error) {
    await input.ops.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function switchCurrent(input: { root: string; releaseRoot: string; ops: ReturnType<typeof operations> }) {
  const current = path.join(input.root, "current")
  const previous = await optionalReadlink(current, input.ops.readlink)
  const temporary = path.join(input.root, `.current-${randomUUID()}`)
  await input.ops.symlink(path.relative(input.root, input.releaseRoot), temporary, "dir")
  await input.ops.rename(temporary, current)
  return previous
}

async function restoreCurrent(root: string, previous: string | undefined, ops: ReturnType<typeof operations>) {
  const current = path.join(root, "current")
  if (!previous) {
    await ops.rm(current, { force: true })
    return
  }
  const temporary = path.join(root, `.current-rollback-${randomUUID()}`)
  await ops.symlink(previous, temporary, "dir")
  await ops.rename(temporary, current)
}

async function deployVersion(input: {
  scope: DeploymentScope
  home: string
  installRoot?: string
  version: string
  ops: ReturnType<typeof operations>
}) {
  const paths = deploymentPaths(input.scope, input.home, input.installRoot)
  await input.ops.mkdir(paths.root, { recursive: true, mode: 0o755 })
  await input.ops.mkdir(paths.releases, { recursive: true, mode: 0o755 })
  await acquireLock(paths.lockPath, input.ops)
  try {
    const releaseRoot = await stageRelease({ root: paths.root, version: input.version, ops: input.ops })
    const previous = await switchCurrent({ root: paths.root, releaseRoot, ops: input.ops })
    return {
      paths,
      previous,
      releaseLock: () => input.ops.rm(paths.lockPath, { recursive: true, force: true }),
    }
  } catch (error) {
    await input.ops.rm(paths.lockPath, { recursive: true, force: true })
    throw error
  }
}

async function prepareLauncher(paths: ReturnType<typeof deploymentPaths>, ops: ReturnType<typeof operations>) {
  const directory = path.dirname(paths.launcherPath)
  await ops.mkdir(directory, { recursive: true, mode: 0o755 })
  const temporary = path.join(directory, `.${SERVICE_NAME}-${randomUUID()}`)
  await ops.symlink(path.relative(directory, paths.cliPath), temporary, "file")
  return {
    commit: () => ops.rename(temporary, paths.launcherPath),
    cleanup: () => ops.rm(temporary, { force: true }),
  }
}

async function resolveBunPath(scope: DeploymentScope, dependencies: DeploymentDependencies) {
  const candidate = path.resolve(dependencies.bunPath ?? process.execPath)
  if (scope === "system" && (candidate.startsWith("/home/") || candidate.startsWith("/root/"))) {
    throw new Error("System installation requires Bun in a system path such as /usr/local/bin/bun")
  }
  return candidate
}

function serviceCommand(scope: DeploymentScope, action: string[]) {
  return { command: "systemctl", args: scope === "system" ? action : ["--user", ...action] }
}

async function restartIfInstalled(scope: DeploymentScope, home: string, installRoot: string, ops: ReturnType<typeof operations>) {
  const unitPath = path.join(
    scope === "system" ? "/etc/systemd/system" : path.join(home, ".config/systemd/user"),
    `${SERVICE_NAME}.service`,
  )
  try {
    const unit = await ops.readFile(unitPath, "utf8")
    if (!unit.split("\n").includes(`Environment=${systemdQuote(`OPENCODE_MEDIA_STUDIO_INSTALL_ROOT=${installRoot}`, "install root")}`))
      return false
  } catch {
    return false
  }
  const enabled = serviceCommand(scope, ["is-enabled", "--quiet", SERVICE_NAME])
  const activeBefore = serviceCommand(scope, ["is-active", "--quiet", SERVICE_NAME])
  const [isEnabled, isActive] = await Promise.all([
    ops.runCommand(enabled.command, enabled.args).then((result) => result.exitCode === 0),
    ops.runCommand(activeBefore.command, activeBefore.args).then((result) => result.exitCode === 0),
  ])
  if (!isEnabled && !isActive) return false
  const restart = serviceCommand(scope, ["restart", SERVICE_NAME])
  const restarted = await ops.runCommand(restart.command, restart.args)
  if (restarted.exitCode !== 0) throw new Error(`Could not restart ${SERVICE_NAME}.service: ${restarted.stderr.trim()}`)
  const active = serviceCommand(scope, ["is-active", "--quiet", SERVICE_NAME])
  if ((await ops.runCommand(active.command, active.args)).exitCode !== 0) throw new Error(`${SERVICE_NAME}.service did not become active`)
  return true
}

async function verifyCompanionHealth(input: {
  scope: DeploymentScope
  home: string
  installRoot: string
  ops: ReturnType<typeof operations>
}) {
  const configPath = path.join(input.installRoot, "deployment.json")
  const config = JSON.parse(await input.ops.readFile(configPath, "utf8")) as { host?: unknown; port?: unknown; service?: unknown }
  if (config.service !== true || typeof config.host !== "string" || typeof config.port !== "number") return
  const packageInfo = JSON.parse(
    await input.ops.readFile(path.join(input.installRoot, "current", "node_modules", PACKAGE_NAME, "package.json"), "utf8"),
  ) as { version?: unknown }
  if (typeof packageInfo.version !== "string") throw new Error("Managed release version is unavailable")
  await waitForCompanionHealth(config.host, config.port, packageInfo.version, input.ops)
}

async function waitForCompanionHealth(
  hostname: string,
  port: number,
  expectedVersion: string | undefined,
  ops: ReturnType<typeof operations>,
) {
  const resolvedHost = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname
  const host = resolvedHost.includes(":") ? `[${resolvedHost}]` : resolvedHost
  let lastError = "health check failed"
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await ops.fetcher(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
      const body = response.ok ? ((await response.json()) as { status?: unknown }) : undefined
      if (!response.ok || body?.status !== "ok") {
        lastError = response.ok ? "health endpoint returned an invalid body" : `health endpoint returned ${response.status}`
      } else if (expectedVersion) {
        const versionResponse = await ops.fetcher(`http://${host}:${port}/api/version`, { signal: AbortSignal.timeout(1000) })
        const version = versionResponse.ok ? ((await versionResponse.json()) as { running?: unknown }) : undefined
        if (versionResponse.ok && version?.running === expectedVersion) return
        lastError = versionResponse.ok
          ? "version endpoint reported another running release"
          : `version endpoint returned ${versionResponse.status}`
      } else {
        return
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await ops.sleep(100)
  }
  throw new Error(`Companion health check failed: ${lastError}`)
}

export async function installService(args: string[], dependencies: DeploymentDependencies = {}) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      directory: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4173" },
      user: { type: "string" },
      group: { type: "string" },
      "install-root": { type: "string" },
      "no-service": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  })
  if (parsed.positionals[0] !== "install" || parsed.positionals.length !== 1) throw new Error("Invalid install command")
  const ops = operations(dependencies)
  const scope = currentScope(ops.getuid)
  const home = ops.homedir()
  const port = Number(parsed.values.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${parsed.values.port}`)
  const installRoot = parsed.values["install-root"]
  const paths = deploymentPaths(scope, home, installRoot)
  const libraryRoot = path.resolve(
    parsed.values.directory ??
      (scope === "system" ? "/srv/opencode-media-studio" : path.join(home, ".local/share/opencode-media-studio/library")),
  )
  const bunPath = await resolveBunPath(scope, dependencies)
  const unit = generateSystemdUnit({
    scope,
    libraryRoot,
    installRoot: paths.root,
    host: parsed.values.host ?? "127.0.0.1",
    port,
    bunPath,
    serviceUser: parsed.values.user,
    serviceGroup: parsed.values.group,
  })
  if (parsed.values["dry-run"]) {
    ops.log(unit)
    return { installed: false as const, scope, unit, paths }
  }

  const deployed = await deployVersion({ scope, home, installRoot, version: manifest.version, ops })
  const unitDir = scope === "system" ? "/etc/systemd/system" : path.join(home, ".config/systemd/user")
  const unitPath = path.join(unitDir, `${SERVICE_NAME}.service`)
  const configPath = path.join(paths.root, "deployment.json")
  const serviceRequested = !parsed.values["no-service"]
  let previousUnit: string | undefined
  let previousConfig: string | undefined
  let unitSnapshotTaken = false
  let configSnapshotTaken = false
  let unitChanged = false
  let serviceEnabled = false
  let serviceActive = false
  let launcher: Awaited<ReturnType<typeof prepareLauncher>> | undefined
  try {
    previousUnit = await optionalReadFile(unitPath, ops.readFile)
    unitSnapshotTaken = true
    previousConfig = await optionalReadFile(configPath, ops.readFile)
    configSnapshotTaken = true
    if (previousUnit !== undefined) {
      const enabledCheck = serviceCommand(scope, ["is-enabled", "--quiet", SERVICE_NAME])
      serviceEnabled = (await ops.runCommand(enabledCheck.command, enabledCheck.args)).exitCode === 0
      const activeCheck = serviceCommand(scope, ["is-active", "--quiet", SERVICE_NAME])
      serviceActive = (await ops.runCommand(activeCheck.command, activeCheck.args)).exitCode === 0
      const managedLine = `Environment=${systemdQuote(`OPENCODE_MEDIA_STUDIO_INSTALL_ROOT=${paths.root}`, "install root")}`
      if (!serviceRequested && previousUnit.split("\n").includes(managedLine) && (serviceEnabled || serviceActive)) {
        throw new Error(`Disable ${SERVICE_NAME}.service before switching this installation to --no-service`)
      }
    }
    launcher = await prepareLauncher(paths, ops)
    if (serviceRequested) {
      await ops.mkdir(unitDir, { recursive: true, mode: 0o755 })
      await writeAtomic(unitPath, unit, 0o644, ops)
      unitChanged = true
      const reload = serviceCommand(scope, ["daemon-reload"])
      if ((await ops.runCommand(reload.command, reload.args)).exitCode !== 0) throw new Error("systemctl daemon-reload failed")
      const enable = serviceCommand(scope, ["enable", "--now", SERVICE_NAME])
      if ((await ops.runCommand(enable.command, enable.args)).exitCode !== 0) throw new Error("systemctl enable --now failed")
      if (serviceActive) {
        const restart = serviceCommand(scope, ["restart", SERVICE_NAME])
        if ((await ops.runCommand(restart.command, restart.args)).exitCode !== 0) throw new Error("systemctl restart failed")
      }
      if (scope === "user") {
        const linger = await ops.runCommand("loginctl", ["enable-linger", ops.username()])
        if (linger.exitCode !== 0) ops.warn("Could not enable linger; the user service starts after login")
      }
      await waitForCompanionHealth(parsed.values.host ?? "127.0.0.1", port, manifest.version, ops)
    }
    await writeAtomic(
      configPath,
      JSON.stringify({ scope, host: parsed.values.host ?? "127.0.0.1", port, service: serviceRequested }, null, 2),
      0o644,
      ops,
    )
    await launcher.commit()
    launcher = undefined
  } catch (error) {
    await restoreCurrent(paths.root, deployed.previous, ops)
    if (configSnapshotTaken) {
      if (previousConfig === undefined) await ops.rm(configPath, { force: true })
      else await writeAtomic(configPath, previousConfig, 0o644, ops)
    }
    const rollbackFailures: string[] = []
    if (serviceRequested && unitChanged) {
      if (unitSnapshotTaken) {
        try {
          if (previousUnit === undefined) await ops.rm(unitPath, { force: true })
          else await writeAtomic(unitPath, previousUnit, 0o644, ops)
        } catch (rollbackError) {
          rollbackFailures.push(`unit restore failed: ${String(rollbackError)}`)
        }
      }
      const reload = serviceCommand(scope, ["daemon-reload"])
      const reloadResult = await ops.runCommand(reload.command, reload.args).catch((rollbackError) => ({
        exitCode: 1,
        stdout: "",
        stderr: String(rollbackError),
      }))
      if (reloadResult.exitCode !== 0) rollbackFailures.push(`daemon-reload failed: ${reloadResult.stderr}`)
      const recoveryActions = serviceActive
        ? [["restart", SERVICE_NAME], ...(serviceEnabled ? [] : [["disable", SERVICE_NAME]])]
        : serviceEnabled
          ? [["stop", SERVICE_NAME]]
          : [["disable", "--now", SERVICE_NAME]]
      for (const action of recoveryActions) {
        const recovery = serviceCommand(scope, action)
        const recoveryResult = await ops.runCommand(recovery.command, recovery.args).catch((rollbackError) => ({
          exitCode: 1,
          stdout: "",
          stderr: String(rollbackError),
        }))
        if (recoveryResult.exitCode !== 0) rollbackFailures.push(`service state restore failed: ${recoveryResult.stderr}`)
      }
      if (rollbackFailures.length === 0 && serviceActive && previousConfig !== undefined) {
        try {
          await verifyCompanionHealth({ scope, home, installRoot: paths.root, ops })
        } catch (rollbackError) {
          rollbackFailures.push(`restored service health failed: ${String(rollbackError)}`)
        }
      }
    }
    if (rollbackFailures.length > 0)
      throw new Error(`Install failed and rollback was incomplete: ${rollbackFailures.join("; ")}`, { cause: error })
    throw error
  } finally {
    await launcher?.cleanup().catch(() => {})
    await deployed.releaseLock()
  }
  ops.log(`Installed OpenCode Media Studio ${manifest.version} (${scope})`)
  if (parsed.values["no-service"]) ops.log("Companion service was not installed; run opencode-media-studio serve when needed")
  ops.log(`CLI: ${paths.launcherPath}`)
  ops.log(`Plugin: ${paths.pluginPath}`)
  ops.log(`Provider: ${pathToFileURL(paths.providerPath).href}`)
  return { installed: true as const, scope, unit, unitPath: parsed.values["no-service"] ? undefined : unitPath, paths }
}

export async function updateService(args: string[], dependencies: DeploymentDependencies = {}) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      version: { type: "string" },
      "install-root": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  if (parsed.positionals[0] !== "update" || parsed.positionals.length !== 1) throw new Error("Invalid update command")
  const ops = operations(dependencies)
  const scope = currentScope(ops.getuid)
  const home = ops.homedir()
  const paths = deploymentPaths(scope, home, parsed.values["install-root"])
  let version = parsed.values.version
  const explicitVersion = version !== undefined
  if (!version) {
    const latest = await ops.runCommand("npm", ["view", PACKAGE_NAME, "version", "--json"])
    if (latest.exitCode !== 0) throw new Error(`Could not check npm for updates: ${latest.stderr.trim()}`)
    try {
      version = JSON.parse(latest.stdout) as string
    } catch {
      throw new Error("npm returned an invalid package version")
    }
  }
  version = validVersion(version)
  if (parsed.values["dry-run"]) {
    ops.log(`Would install ${PACKAGE_NAME}@${version} into ${paths.root}`)
    return { updated: false as const, scope, version, paths }
  }

  if (!explicitVersion) {
    try {
      const installedManifest = JSON.parse(await ops.readFile(path.join(paths.packageRoot, "package.json"), "utf8")) as {
        version?: unknown
      }
      if (typeof installedManifest.version === "string" && compareVersions(version, installedManifest.version) <= 0) {
        ops.log(`OpenCode Media Studio ${installedManifest.version} is already current`)
        return { updated: false as const, scope, version: installedManifest.version, paths }
      }
    } catch {
      // Release validation below reports malformed managed installs.
    }
  }

  if (!(await optionalReadlink(paths.current, ops.readlink)))
    throw new Error("No managed installation found; run opencode-media-studio install first")
  const deployed = await deployVersion({
    scope,
    home,
    installRoot: parsed.values["install-root"],
    version,
    ops,
  })
  try {
    const restarted = await restartIfInstalled(scope, home, paths.root, ops)
    if (restarted) {
      const config = JSON.parse(await ops.readFile(path.join(paths.root, "deployment.json"), "utf8")) as { host?: unknown; port?: unknown }
      if (typeof config.host !== "string" || typeof config.port !== "number")
        throw new Error("Managed companion deployment config is invalid")
      await waitForCompanionHealth(config.host, config.port, version, ops)
    }
    ops.log(`Updated OpenCode Media Studio to ${version}`)
    ops.log(restarted ? "Companion restarted" : "No managed companion service found; restart any running companion manually")
    ops.log("Restart running OpenCode clients to load the new plugin version")
    return { updated: true as const, scope, version, restarted, paths }
  } catch (error) {
    await restoreCurrent(paths.root, deployed.previous, ops)
    let recoveryError: unknown
    try {
      if (await restartIfInstalled(scope, home, paths.root, ops)) await verifyCompanionHealth({ scope, home, installRoot: paths.root, ops })
    } catch (rollbackError) {
      recoveryError = rollbackError
    }
    if (recoveryError)
      throw new Error(`Update failed and rollback health could not be confirmed: ${String(recoveryError)}`, { cause: error })
    throw error
  } finally {
    await deployed.releaseLock()
  }
}
