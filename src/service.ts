import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveWorkspace } from "./core/paths"

export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status"

export const PACKAGE_NAME = "@oguzkaganozt/opencode-studio"

export type ServiceOptions = {
  workspace?: string
  /** Bind mode: local (127.0.0.1) or web (0.0.0.0). Default local. */
  mode?: "local" | "web"
  port?: number
  /** systemd unit name without .service (default: opencode-studio) */
  name?: string
  json?: boolean
}

function unitName(name?: string) {
  const base = (name ?? "opencode-studio").replace(/[^a-zA-Z0-9_.@-]/g, "-")
  if (!base) throw new Error("Invalid --name")
  return base.endsWith(".service") ? base : `${base}.service`
}

function userUnitDir() {
  const xdg = process.env.XDG_CONFIG_HOME
  const root = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".config")
  return path.join(root, "systemd", "user")
}

function unitPath(name?: string) {
  return path.join(userUnitDir(), unitName(name))
}

/** Absolute path suitable for ExecStart (global bin shim or running CLI entry). */
export function resolveServeExecutable(): { command: string; argsPrefix: string[] } {
  const onPath = Bun.which("opencode-studio")
  if (onPath) return { command: onPath, argsPrefix: [] }

  const entry = process.argv[1] ? path.resolve(process.argv[1]) : ""
  if (entry) {
    const runtime = process.execPath
    return { command: runtime, argsPrefix: [entry] }
  }
  throw new Error("Could not resolve opencode-studio executable; ensure it is on PATH")
}

export function renderUserUnit(input: {
  workspace: string
  mode: "local" | "web"
  port: number
  pathEnv: string
  agentPassword?: string
  agentPasswordEnvironment?: string
  agentUsername?: string
  agentUsernameEnvironment?: string
  executable: { command: string; argsPrefix: string[] }
}) {
  const modeFlag = input.mode === "web" ? "--web" : "--local"
  const args = [...input.executable.argsPrefix, "serve", "--workspace", input.workspace, modeFlag, "--port", String(input.port)]

  const execStart = [input.executable.command, ...args].map(shellEscape).join(" ")
  const agentPassword = input.agentPassword
    ? `Environment=OPENCODE_STUDIO_PASSWORD=${shellEscape(input.agentPassword.replace(/%/g, "%%"))}\n`
    : input.agentPasswordEnvironment
      ? `${input.agentPasswordEnvironment}\n`
      : ""
  const agentUsername = input.agentUsername
    ? `Environment=OPENCODE_STUDIO_USERNAME=${shellEscape(input.agentUsername.replace(/%/g, "%%"))}\n`
    : input.agentUsernameEnvironment
      ? `${input.agentUsernameEnvironment}\n`
      : ""

  return `[Unit]
Description=OpenCode Studio host (${input.workspace})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${shellEscape(input.workspace)}
Environment=PATH=${shellEscape(input.pathEnv)}
${agentUsername}${agentPassword}ExecStart=${execStart}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`
}

function shellEscape(value: string) {
  // systemd unit values with spaces need quoting; escape embedded quotes/newlines.
  if (/[\n\r]/.test(value)) throw new Error("Invalid character in service path")
  if (/[\s"$\\]/.test(value)) return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  return value
}

async function existingEnvironmentLine(file: string, key: string) {
  try {
    const body = await readFile(file, "utf8")
    return body.split("\n").find((line) => line.startsWith(`Environment=${key}=`))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function existingAgentPasswordEnvironment(file: string) {
  return existingEnvironmentLine(file, "OPENCODE_STUDIO_PASSWORD")
}

async function existingAgentUsernameEnvironment(file: string) {
  return existingEnvironmentLine(file, "OPENCODE_STUDIO_USERNAME")
}

async function runSystemctl(args: string[]) {
  const proc = Bun.spawn(["systemctl", "--user", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { ok: code === 0, code, stdout, stderr }
}

function requireSystemdUser() {
  if (!Bun.which("systemctl")) {
    throw new Error("systemctl not found — background service requires systemd (Linux user session)")
  }
}

async function unitFileExists(name?: string): Promise<boolean> {
  try {
    await access(unitPath(name))
    return true
  } catch {
    return false
  }
}

export const OPENCODE_RESTART_HINT = "Restart OpenCode so its unversioned plugin registration resolves the new package."

/** Read-only registry check against the installed package version. */
export async function checkPackageUpgrade(input?: { packageRoot?: string; ttlMs?: number }): Promise<{
  action: "check"
  packageName: string
  current: string
  latest: string | null
  updateAvailable: boolean
  message: string
  error?: string
}> {
  const { checkNpmUpdate } = await import("./core/update-check")
  const { loadPackageMeta } = await import("./core/package-meta")
  const { packageRootFrom } = await import("./core/paths")
  const packageRoot = input?.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const info = await checkNpmUpdate({
    packageName: meta.name,
    current: meta.version,
    ttlMs: input?.ttlMs ?? 0,
  })
  if (info.error && !info.latest) {
    return {
      action: "check",
      packageName: meta.name,
      current: meta.version,
      latest: null,
      updateAvailable: false,
      message: `Could not check for updates: ${info.error}`,
      error: info.error,
    }
  }
  if (info.updateAvailable && info.latest) {
    return {
      action: "check",
      packageName: meta.name,
      current: meta.version,
      latest: info.latest,
      updateAvailable: true,
      message: `Update available: ${meta.version} → ${info.latest}. Run: opencode-studio upgrade`,
    }
  }
  return {
    action: "check",
    packageName: meta.name,
    current: meta.version,
    latest: info.latest ?? meta.version,
    updateAvailable: false,
    message: `Up to date (${meta.version}).`,
  }
}

/** bun add -g @latest; if a user systemd unit exists, refresh and restart it. */
export async function upgradePackage(options: ServiceOptions = {}): Promise<{
  action: "upgrade"
  packageName: string
  serviceRestarted: boolean
  unit?: string
  installOutput: string
  message: string
  restartOpenCode: true
}> {
  const bun = Bun.which("bun")
  if (!bun) throw new Error("bun not found on PATH (required to install/upgrade opencode-studio)")
  const install = Bun.spawn([bun, "add", "-g", `${PACKAGE_NAME}@latest`], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(install.stdout).text(), new Response(install.stderr).text(), install.exited])
  if (code !== 0) throw new Error(err.trim() || out.trim() || "bun add -g failed")
  const installOutput = (out.trim() || err.trim()).trim()

  const hasUnit = await unitFileExists(options.name)
  if (!hasUnit) {
    return {
      action: "upgrade",
      packageName: PACKAGE_NAME,
      serviceRestarted: false,
      installOutput,
      restartOpenCode: true,
      message: [`Updated ${PACKAGE_NAME} (no systemd unit found — skip service restart).`, installOutput, "", OPENCODE_RESTART_HINT]
        .filter(Boolean)
        .join("\n")
        .trim(),
    }
  }

  // Refresh unit ExecStart/PATH in case the global shim moved.
  const service = await manageService("install", options)
  return {
    action: "upgrade",
    packageName: PACKAGE_NAME,
    serviceRestarted: true,
    unit: "unit" in service ? String(service.unit) : unitName(options.name),
    installOutput,
    restartOpenCode: true,
    message: [`Updated ${PACKAGE_NAME} and restarted ${unitName(options.name)}.`, installOutput, "", OPENCODE_RESTART_HINT]
      .filter(Boolean)
      .join("\n")
      .trim(),
  }
}

export async function manageService(action: ServiceAction, options: ServiceOptions = {}) {
  requireSystemdUser()
  const workspace = await resolveWorkspace(options.workspace)
  const mode = options.mode === "web" ? "web" : "local"
  const host = mode === "web" ? "0.0.0.0" : "127.0.0.1"
  const port = options.port ?? 4173
  if (!Number.isInteger(port) || port <= 0) throw new Error("Invalid --port")
  const name = options.name
  const file = unitPath(name)
  const unit = unitName(name)

  if (action === "install") {
    const executable = resolveServeExecutable()
    const pathEnv = process.env.PATH ?? "/usr/bin:/bin"
    const agentPassword = process.env.OPENCODE_STUDIO_PASSWORD
    const agentUsername = process.env.OPENCODE_STUDIO_USERNAME
    const existingPassword = agentPassword ? undefined : await existingAgentPasswordEnvironment(file)
    const existingUsername = agentUsername ? undefined : await existingAgentUsernameEnvironment(file)
    if (mode === "web" && !agentPassword?.trim() && !existingPassword) {
      throw new Error("web mode requires OPENCODE_STUDIO_PASSWORD (set it when running service install)")
    }
    const body = renderUserUnit({
      workspace,
      mode,
      port,
      pathEnv,
      agentPassword,
      agentPasswordEnvironment: agentPassword ? undefined : existingPassword,
      agentUsername: agentUsername?.trim() || undefined,
      agentUsernameEnvironment: agentUsername?.trim() ? undefined : existingUsername,
      executable,
    })
    await mkdir(userUnitDir(), { recursive: true, mode: 0o755 })
    await writeFile(file, body, { mode: 0o600 })
    await chmod(file, 0o600)
    const reload = await runSystemctl(["daemon-reload"])
    if (!reload.ok) throw new Error(reload.stderr.trim() || "systemctl daemon-reload failed")
    const enable = await runSystemctl(["enable", "--now", unit])
    if (!enable.ok) throw new Error(enable.stderr.trim() || `failed to enable ${unit}`)
    return {
      action,
      unit,
      unitPath: file,
      workspace,
      mode,
      host,
      port,
      url: `http://${host}:${port}/studio`,
      message: `Installed and started ${unit} (${mode}). Open ${`http://${host}:${port}/studio`}. If the service dies after logout, run: loginctl enable-linger $USER`,
    }
  }

  if (action === "uninstall") {
    await runSystemctl(["disable", "--now", unit])
    await rm(file, { force: true })
    await runSystemctl(["daemon-reload"])
    return { action, unit, unitPath: file, message: `Removed ${unit}` }
  }

  if (action === "start" || action === "stop" || action === "restart") {
    const result = await runSystemctl([action, unit])
    if (!result.ok) throw new Error(result.stderr.trim() || `systemctl ${action} ${unit} failed`)
    return { action, unit, message: result.stdout.trim() || `${action} ${unit}` }
  }

  // status — include optional update hint when network is available
  const result = await runSystemctl(["status", "--no-pager", unit])
  let updateLine = ""
  try {
    const { checkNpmUpdate } = await import("./core/update-check")
    const { loadPackageMeta } = await import("./core/package-meta")
    const { packageRootFrom } = await import("./core/paths")
    const meta = await loadPackageMeta(packageRootFrom(import.meta.dir))
    const update = await checkNpmUpdate({ packageName: meta.name, current: meta.version })
    if (update.updateAvailable && update.message) updateLine = `\n${update.message}`
  } catch {
    // ignore
  }
  return {
    action,
    unit,
    unitPath: file,
    ok: result.ok,
    code: result.code,
    stdout: `${result.stdout}${updateLine}`,
    stderr: result.stderr,
  }
}
