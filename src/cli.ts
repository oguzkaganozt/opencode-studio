#!/usr/bin/env bun
import path from "node:path"
import { parseArgs } from "node:util"
import { completionScript, isCompletionShell } from "./completion"
import { ensureShellCompletions } from "./completion-install"
import { loadPackageMeta } from "./core/package-meta"
import { resolveWorkspace } from "./core/paths"
import { STUDIO_IDS } from "./core/registry"
import { assertLoopbackBind, assertWebPassword, hostnameForBindMode, resolveBindMode } from "./core/security"
import { configureStudios, doctorStudios, getPackageRoot, removeStudios, statusStudios } from "./lifecycle"
import { startHost } from "./server"
import { checkPackageUpgrade, manageService, type ServiceAction, upgradePackage } from "./service"

const SERVICE_ACTIONS: ServiceAction[] = ["install", "uninstall", "start", "stop", "restart", "status"]

function printHelp() {
  console.log(`opencode-studio

User-global config (~/.config/opencode-studio + ~/.config/opencode).
--workspace is the domain data root for CAD/PCB (default: cwd).

Commands:
  configure <studio...>   Enable studios globally (cad|pcb)
  status                  Show enablement, roots, package version
  doctor                  Health checks (exit 1 if any fail)
  serve                   Run OpenCode + integrated Studio host
  service <action>        systemd user unit (install|uninstall|start|stop|restart|status)
  upgrade [--check]       npm i -g @latest; restart unit if installed
  remove                  Disable domain studios (platform media stays on)
  completion bash|zsh     Print shell completion script
  completion install      Append completion to shell rc
  version                 Print package version

Common flags:
  --workspace <path>   Domain data root (default: cwd)
  --json               Machine-readable output (where supported)
  -h, --help           Help
  -v, --version        Version

Examples:
  opencode-studio configure cad pcb
  opencode-studio serve --workspace ~/project
  opencode-studio serve --web
  opencode-studio upgrade --check
  opencode-studio upgrade
  opencode-studio service install --workspace ~/project

Notes:
  serve defaults to --local (127.0.0.1). --web binds 0.0.0.0 and requires OPENCODE_STUDIO_PASSWORD.
  upgrade restarts the systemd unit when present, then reminds you to restart OpenCode.
  upgrade --check exits 1 if an update is available, 2 on registry error.
  Global npm install may auto-append shell completion (OPENCODE_STUDIO_SKIP_COMPLETION=1 to skip).
`)
}

function printCommandHelp(command: string) {
  const studios = STUDIO_IDS.join("|")
  const texts: Record<string, string> = {
    configure: `opencode-studio configure <studio...> [options]

Enable studios in user-global config and register plugins/manage skills.
Studios: ${studios}

Options:
  --workspace <path>   Domain data root (required when enabling studios)
  --dry-run            Print actions without writing
  --json               JSON result
  -h, --help

To clear all studios, use: opencode-studio remove
`,
    status: `opencode-studio status [options]

Show package version, config path, domain root, and per-studio enablement.

Options:
  --workspace <path>   Domain data root (default: cwd)
  --json
  -h, --help
`,
    doctor: `opencode-studio doctor [options]

Run health checks. Exit 0 if ok, 1 if any check fails.

Options:
  --workspace <path>
  --json
  -h, --help
`,
    serve: `opencode-studio serve [options]

Start OpenCode and the integrated Studio viewer (foreground).

Options:
  --workspace <path>     Domain data root (default: cwd)
  --local                Bind 127.0.0.1 (default)
  --web                  Bind 0.0.0.0; requires OPENCODE_STUDIO_PASSWORD
  --port <port>          Default 4173
  --ui-directory <path>  Override UI dist
  -h, --help
`,
    service: `opencode-studio service <action> [options]

Manage the systemd user unit for a background host.

Actions: ${SERVICE_ACTIONS.join("|")}

Options:
  --workspace <path>   Domain data root (used on install)
  --local              Bind 127.0.0.1 (default on install)
  --web                Bind 0.0.0.0; requires OPENCODE_STUDIO_PASSWORD
  --port <port>        Default 4173
  --name <unit>        Unit name without .service (default opencode-studio)
  --json
  -h, --help
`,
    upgrade: `opencode-studio upgrade [options]

Install @oguzkaganozt/opencode-studio@latest via npm.
If a systemd user unit exists, reinstall/restart it.
Always reminds you to restart OpenCode.

Options:
  --check              Only check registry (exit 1 if update available, 2 on error)
  --workspace <path>   Passed through when refreshing the unit
  --local              Bind mode when refreshing the unit (default)
  --web                Web bind mode when refreshing the unit
  --port <port>        Default 4173
  --name <unit>
  --json
  -h, --help
`,
    remove: `opencode-studio remove [options]

Disable domain studios (cad/pcb). Platform media tools, media-go, and the media skill stay installed.

Options:
  --workspace <path>   Optional domain root for local scrub during remove
  --json
  -h, --help
`,
    completion: `opencode-studio completion bash|zsh|install

  bash|zsh   Print completion script (eval into your shell rc)
  install    Append eval line to the active shell rc if missing

Options (install):
  -q, --quiet
  -h, --help
`,
    version: `opencode-studio version

Print the installed package version.
`,
  }
  const text = texts[command]
  if (!text) {
    printHelp()
    return
  }
  console.log(`${text.trimEnd()}\n`)
}

function wantsHelp(args: string[]) {
  return args.includes("-h") || args.includes("--help")
}

function wantsVersion(args: string[]) {
  return args.length === 1 && (args[0] === "-v" || args[0] === "--version" || args[0] === "version")
}

function parsePort(raw: string | undefined, fallback = 4173): number | null {
  const port = Number(raw ?? fallback)
  if (!Number.isInteger(port) || port <= 0) return null
  return port
}

function failParse(command: string, error: unknown) {
  console.error(error instanceof Error ? error.message : error)
  printCommandHelp(command)
  return 2
}

async function main(argv: string[]) {
  if (argv.length === 0 || (argv.length === 1 && wantsHelp(argv))) {
    printHelp()
    return 0
  }

  const packageRoot = getPackageRoot()

  if (wantsVersion(argv)) {
    const meta = await loadPackageMeta(packageRoot)
    console.log(meta.version)
    return 0
  }

  const command = argv[0]!
  const rest = argv.slice(1)

  // Any -h/--help on a known command shows that command's help.
  if (wantsHelp(rest)) {
    printCommandHelp(command)
    return 0
  }

  if (command === "configure") {
    let values: { workspace?: string; "dry-run"?: boolean; json?: boolean }
    let positionals: string[]
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          workspace: { type: "string" },
          "dry-run": { type: "boolean", default: false },
          json: { type: "boolean", default: false },
        },
        allowPositionals: true,
        strict: true,
      })
      values = parsed.values
      positionals = parsed.positionals
    } catch (error) {
      return failParse("configure", error)
    }
    if (positionals.length === 0) {
      console.error(`Usage: opencode-studio configure <studio...>  (studios: ${STUDIO_IDS.join(", ")})`)
      console.error("To disable all studios, run: opencode-studio remove")
      return 2
    }
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
    let values: { workspace?: string; json?: boolean }
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          workspace: { type: "string" },
          json: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
      })
      values = parsed.values
    } catch (error) {
      return failParse("status", error)
    }
    const result = await statusStudios({ workspace: values.workspace, packageRoot })
    const meta = await loadPackageMeta(packageRoot)
    if (values.json) console.log(JSON.stringify({ packageVersion: meta.version, packageName: meta.name, ...result }, null, 2))
    else {
      console.log(`Package: ${meta.name}@${meta.version}`)
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
    let values: { workspace?: string; json?: boolean }
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          workspace: { type: "string" },
          json: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
      })
      values = parsed.values
    } catch (error) {
      return failParse("doctor", error)
    }
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
    let values: { workspace?: string; json?: boolean }
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          workspace: { type: "string" },
          json: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
      })
      values = parsed.values
    } catch (error) {
      return failParse("remove", error)
    }
    const result = await removeStudios({ workspace: values.workspace, packageRoot })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else console.log("Removed all Studios (user-global). Restart OpenCode and the host.")
    return 0
  }

  if (command === "serve") {
    let values: {
      workspace?: string
      local?: boolean
      web?: boolean
      port?: string
      "ui-directory"?: string
    }
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          workspace: { type: "string" },
          local: { type: "boolean", default: false },
          web: { type: "boolean", default: false },
          port: { type: "string", default: "4173" },
          "ui-directory": { type: "string" },
        },
        allowPositionals: false,
        strict: true,
      })
      values = parsed.values
    } catch (error) {
      return failParse("serve", error)
    }
    let mode: ReturnType<typeof resolveBindMode>
    try {
      mode = resolveBindMode({ local: values.local, web: values.web })
      assertWebPassword(mode)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 2
    }
    const hostname = hostnameForBindMode(mode)
    assertLoopbackBind(hostname)
    const workspace = await resolveWorkspace(values.workspace)
    const uiDirectory = values["ui-directory"] ?? path.join(packageRoot, "dist", "ui")
    const port = parsePort(values.port)
    if (port === null) {
      console.error("Invalid --port")
      return 2
    }
    const { studioUrl, opencodeUrl } = await startHost({
      workspace,
      hostname,
      port,
      uiDirectory,
      packageRoot,
    })
    console.log(`mode: ${mode}`)
    console.log(`Studio: ${studioUrl}`)
    if (opencodeUrl) console.log(`OpenCode: ${opencodeUrl}`)
    else console.log("OpenCode: attached server (native proxy disabled)")
    console.log(`workspace: ${workspace}`)
    await new Promise(() => {})
    return 0
  }

  if (command === "completion") {
    const sub = rest[0]
    if (sub === "install") {
      const quiet = rest.includes("--quiet") || rest.includes("-q")
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
    let values: {
      check?: boolean
      workspace?: string
      local?: boolean
      web?: boolean
      port?: string
      name?: string
      json?: boolean
    }
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          check: { type: "boolean", default: false },
          workspace: { type: "string" },
          local: { type: "boolean", default: false },
          web: { type: "boolean", default: false },
          port: { type: "string", default: "4173" },
          name: { type: "string" },
          json: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
      })
      values = parsed.values
    } catch (error) {
      return failParse("upgrade", error)
    }

    if (values.check) {
      const result = await checkPackageUpgrade({ packageRoot })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else console.log(result.message)
      if (result.error && !result.latest) return 2
      return result.updateAvailable ? 1 : 0
    }

    let mode: ReturnType<typeof resolveBindMode>
    try {
      mode = resolveBindMode({ local: values.local, web: values.web })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 2
    }
    const port = parsePort(values.port)
    if (port === null) {
      console.error("Invalid --port")
      return 2
    }
    const result = await upgradePackage({
      workspace: values.workspace,
      mode,
      port,
      name: values.name,
      json: values.json,
    })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else console.log(result.message)
    return 0
  }

  if (command === "service") {
    const action = rest[0] as ServiceAction | undefined
    if (!action || !SERVICE_ACTIONS.includes(action)) {
      console.error("Usage: opencode-studio service install|uninstall|start|stop|restart|status [options]")
      return 2
    }
    let values: {
      workspace?: string
      local?: boolean
      web?: boolean
      port?: string
      name?: string
      json?: boolean
    }
    try {
      const parsed = parseArgs({
        args: rest.slice(1),
        options: {
          workspace: { type: "string" },
          local: { type: "boolean", default: false },
          web: { type: "boolean", default: false },
          port: { type: "string", default: "4173" },
          name: { type: "string" },
          json: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
      })
      values = parsed.values
    } catch (error) {
      return failParse("service", error)
    }
    let mode: ReturnType<typeof resolveBindMode>
    try {
      mode = resolveBindMode({ local: values.local, web: values.web })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 2
    }
    if (action === "install") assertLoopbackBind(hostnameForBindMode(mode))
    const port = parsePort(values.port)
    if (port === null) {
      console.error("Invalid --port")
      return 2
    }
    const result = await manageService(action, {
      workspace: values.workspace,
      mode,
      port,
      name: values.name,
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

  if (command === "version") {
    const meta = await loadPackageMeta(packageRoot)
    console.log(meta.version)
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
