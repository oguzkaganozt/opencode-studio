#!/usr/bin/env bun
import path from "node:path"
import { parseArgs } from "node:util"
import { completionScript, isCompletionShell } from "./completion"
import { ensureShellCompletions } from "./completion-install"
import { resolveWorkspace } from "./core/paths"
import { assertLoopbackBind } from "./core/security"
import { configureStudios, doctorStudios, getPackageRoot, removeStudios, statusStudios } from "./lifecycle"
import { startHost } from "./server"
import { checkPackageUpgrade, manageService, type ServiceAction, upgradePackage } from "./service"

function printHelp() {
  console.log(`opencode-studio

Config is user-global (~/.config/opencode-studio + ~/.config/opencode).
--workspace is the domain data root for CAD/PCB/startup (default: cwd).

Usage:
  opencode-studio configure <studio...> [--workspace <path>]
  opencode-studio status [--workspace <path>]
  opencode-studio doctor [--workspace <path>]
  opencode-studio serve [--workspace <path>] [--host <host>] [--port <port>] [--allow-non-loopback]
  opencode-studio service install|uninstall|start|stop|restart|status [--workspace <path>] [--host <host>] [--port <port>] [--name <unit>]
  opencode-studio upgrade [--check] [--workspace <path>] [--host <host>] [--port <port>] [--name <unit>]
  opencode-studio remove
  opencode-studio completion bash|zsh
  opencode-studio completion install

  upgrade         npm i -g @latest; restarts systemd unit if installed; reminds to restart OpenCode
  upgrade --check only report whether a newer npm version exists (exit 1 if yes)

Shell tab completion:
  Global npm install tries to append eval lines to ~/.bashrc and ~/.zshrc.
  Manual:
    opencode-studio completion install
    # or: eval "$(opencode-studio completion bash)"  # → ~/.bashrc
  Skip auto-install: OPENCODE_STUDIO_SKIP_COMPLETION=1
`)
}

async function main(argv: string[]) {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    printHelp()
    return 0
  }

  const command = argv[0]!
  const rest = argv.slice(1)
  const packageRoot = getPackageRoot()

  if (command === "configure") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        workspace: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    })
    const result = await configureStudios({
      workspace: values.workspace,
      enabled: positionals,
      packageRoot,
      dryRun: values["dry-run"],
    })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(`Configured studios (global): ${result.enabled.join(", ") || "(none)"}`)
      if ("configPath" in result && result.configPath) console.log(`Config: ${result.configPath}`)
      console.log(
        "Restart OpenCode. If opencode-studio serve is already running, restart it too (CLI configure does not hot-reload the host).",
      )
    }
    return 0
  }

  if (command === "status") {
    const { values } = parseArgs({
      args: rest,
      options: {
        workspace: { type: "string" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    })
    const result = await statusStudios({ workspace: values.workspace, packageRoot })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(`Config: ${result.configPath}`)
      console.log(`Domain root: ${result.workspace}`)
      if (result.configError) console.log(`Config error: ${result.configError}`)
      console.log(`Enabled: ${result.enabled.join(", ") || "(none)"}`)
      for (const studio of result.studios) {
        const mark = studio.enabled ? "on " : "off"
        console.log(`  [${mark}] ${studio.id}  root=${studio.root ?? studio.rootError ?? "?"}`)
      }
    }
    return 0
  }

  if (command === "doctor") {
    const { values } = parseArgs({
      args: rest,
      options: {
        workspace: { type: "string" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    })
    const result = await doctorStudios({ workspace: values.workspace, packageRoot })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else {
      for (const check of result.checks) {
        console.log(`${check.status.padEnd(4)} ${check.id}: ${check.message}`)
      }
    }
    return result.ok ? 0 : 1
  }

  if (command === "remove") {
    const { values } = parseArgs({
      args: rest,
      options: {
        workspace: { type: "string" },
        json: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    })
    const result = await removeStudios({ workspace: values.workspace, packageRoot })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else console.log("Removed all Studios (user-global). Restart OpenCode and the host.")
    return 0
  }

  if (command === "serve") {
    const { values } = parseArgs({
      args: rest,
      options: {
        workspace: { type: "string" },
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "4173" },
        "ui-directory": { type: "string" },
        "allow-non-loopback": { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    })
    const hostname = values.host ?? "127.0.0.1"
    assertLoopbackBind(hostname, values["allow-non-loopback"])
    // Default workspace is cwd (same as configure/status/doctor).
    const workspace = await resolveWorkspace(values.workspace)
    const uiDirectory = values["ui-directory"] ?? path.join(packageRoot, "dist", "ui")
    const port = Number(values.port)
    if (!Number.isInteger(port) || port <= 0) {
      console.error("Invalid --port")
      return 2
    }
    const { url } = await startHost({
      workspace,
      hostname,
      port,
      uiDirectory,
      packageRoot,
    })
    console.log(`opencode-studio listening on ${url}`)
    console.log(`workspace: ${workspace}`)
    await new Promise(() => {})
    return 0
  }

  if (command === "completion") {
    const sub = rest[0]
    if (sub === "install") {
      const quiet = rest.includes("--quiet") || rest.includes("-q")
      // OPENCODE_STUDIO_COMPLETION_HOME isolates tests from the real $HOME.
      const home = process.env.OPENCODE_STUDIO_COMPLETION_HOME
      const result = await ensureShellCompletions(home ? { home } : undefined)
      if (result.skipped) {
        if (!quiet) console.log(`Completion install skipped: ${result.reason ?? "unknown"}`)
        return 0
      }
      if (!quiet) {
        for (const p of result.updated) console.log(`Added completion to ${p}`)
        for (const p of result.already) console.log(`Already configured: ${p}`)
        for (const p of result.missing) console.log(`No rc file (skipped): ${p}`)
        if (result.updated.length > 0) {
          console.log("Open a new shell (or source the rc file) for tab completion.")
        } else if (result.already.length === 0) {
          console.log('No shell rc updated. Add manually: eval "$(opencode-studio completion bash)"')
        }
      } else if (result.updated.length > 0) {
        console.log(`[opencode-studio] shell completion → ${result.updated.join(", ")}`)
      }
      return 0
    }
    if (!sub || !isCompletionShell(sub)) {
      console.error("Usage: opencode-studio completion bash|zsh|install")
      return 2
    }
    process.stdout.write(completionScript(sub))
    return 0
  }

  if (command === "upgrade") {
    const { values } = parseArgs({
      args: rest,
      options: {
        check: { type: "boolean", default: false },
        workspace: { type: "string" },
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "4173" },
        name: { type: "string" },
        "allow-non-loopback": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    })

    if (values.check) {
      const result = await checkPackageUpgrade({ packageRoot })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else console.log(result.message)
      if (result.error && !result.latest) return 2
      return result.updateAvailable ? 1 : 0
    }

    const hostname = values.host ?? "127.0.0.1"
    const port = Number(values.port)
    if (!Number.isInteger(port) || port <= 0) {
      console.error("Invalid --port")
      return 2
    }
    const result = await upgradePackage({
      workspace: values.workspace,
      host: hostname,
      port,
      name: values.name,
      allowNonLoopback: values["allow-non-loopback"],
      json: values.json,
    })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else console.log(result.message)
    return 0
  }

  if (command === "service") {
    const action = rest[0] as ServiceAction | undefined
    const allowed: ServiceAction[] = ["install", "uninstall", "start", "stop", "restart", "status"]
    if (!action || !allowed.includes(action)) {
      console.error("Usage: opencode-studio service install|uninstall|start|stop|restart|status [options]")
      return 2
    }
    const { values } = parseArgs({
      args: rest.slice(1),
      options: {
        workspace: { type: "string" },
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "4173" },
        name: { type: "string" },
        "allow-non-loopback": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    })
    const hostname = values.host ?? "127.0.0.1"
    if (action === "install") assertLoopbackBind(hostname, values["allow-non-loopback"])
    const port = Number(values.port)
    if (!Number.isInteger(port) || port <= 0) {
      console.error("Invalid --port")
      return 2
    }
    const result = await manageService(action, {
      workspace: values.workspace,
      host: hostname,
      port,
      name: values.name,
      allowNonLoopback: values["allow-non-loopback"],
      json: values.json,
    })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else if (action === "status") {
      if ("stdout" in result && result.stdout) process.stdout.write(result.stdout)
      if ("stderr" in result && result.stderr) process.stderr.write(result.stderr)
      return "ok" in result && result.ok === false ? 1 : 0
    } else if ("message" in result && result.message) console.log(result.message)
    return 0
  }

  console.error(`Unknown command: ${command}`)
  printHelp()
  return 2
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}

export { main }
