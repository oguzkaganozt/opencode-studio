import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveWorkspace } from "./core/paths"

export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status"

export type ServiceOptions = {
  workspace?: string
  host?: string
  port?: number
  /** systemd unit name without .service (default: opencode-studio) */
  name?: string
  allowNonLoopback?: boolean
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
  host: string
  port: number
  allowNonLoopback: boolean
  pathEnv: string
  executable: { command: string; argsPrefix: string[] }
}) {
  const args = [...input.executable.argsPrefix, "serve", "--workspace", input.workspace, "--host", input.host, "--port", String(input.port)]
  if (input.allowNonLoopback) args.push("--allow-non-loopback")

  const execStart = [input.executable.command, ...args].map(shellEscape).join(" ")

  return `[Unit]
Description=OpenCode Studio host (${input.workspace})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${shellEscape(input.workspace)}
Environment=PATH=${shellEscape(input.pathEnv)}
ExecStart=${execStart}
Restart=on-failure
RestartSec=3

# Loopback-only by default; do not expose without --allow-non-loopback at install time.
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

export async function manageService(action: ServiceAction, options: ServiceOptions = {}) {
  requireSystemdUser()
  const workspace = await resolveWorkspace(options.workspace)
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? 4173
  if (!Number.isInteger(port) || port <= 0) throw new Error("Invalid --port")
  const name = options.name
  const file = unitPath(name)
  const unit = unitName(name)

  if (action === "install") {
    const executable = resolveServeExecutable()
    const pathEnv = process.env.PATH ?? "/usr/bin:/bin"
    const body = renderUserUnit({
      workspace,
      host,
      port,
      allowNonLoopback: Boolean(options.allowNonLoopback),
      pathEnv,
      executable,
    })
    await mkdir(userUnitDir(), { recursive: true, mode: 0o755 })
    await writeFile(file, body, { mode: 0o644 })
    const reload = await runSystemctl(["daemon-reload"])
    if (!reload.ok) throw new Error(reload.stderr.trim() || "systemctl daemon-reload failed")
    const enable = await runSystemctl(["enable", "--now", unit])
    if (!enable.ok) throw new Error(enable.stderr.trim() || `failed to enable ${unit}`)
    return {
      action,
      unit,
      unitPath: file,
      workspace,
      host,
      port,
      url: `http://${host}:${port}`,
      message: `Installed and started ${unit}. Open ${`http://${host}:${port}`}. If the service dies after logout, run: loginctl enable-linger $USER`,
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

  // status
  const result = await runSystemctl(["status", "--no-pager", unit])
  return {
    action,
    unit,
    unitPath: file,
    ok: result.ok,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
