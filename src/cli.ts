#!/usr/bin/env bun
import path from "node:path"
import { parseArgs } from "node:util"
import { loadPackageMeta } from "./core/package-meta"
import { resolveWorkspace } from "./core/paths"
import { assertLoopbackBind, assertWebPassword, hostnameForBindMode, resolveBasicUsername, resolveBindMode } from "./core/security"
import { configureStudios, getPackageRoot, removeStudios, statusStudios } from "./lifecycle"
import { startHost } from "./server"
import { checkPackageUpgrade, manageService, type ServiceAction, upgradePackage } from "./service"

const SERVICE_ACTIONS: ServiceAction[] = ["install", "uninstall", "start", "stop", "restart", "status"]

function printHelp() {
  console.log(`opencode-studio

CAD and PCB are always on. Global install wires OpenCode once
(plugins, skills, MCP). --workspace is the domain data root (default: cwd).

Commands:
  serve      Run Studio host + OpenCode sidecar
  status     Health, roots, skills (exit 1 if broken)
  repair     Reinstall plugins, skills, MCP
  remove     Uninstall managed OpenCode state (package stays)
  upgrade    bun add -g @latest (+ restart systemd unit if any)

Linux:
  service install|uninstall|start|stop|restart|status

Flags:
  --workspace <path>   Domain data root (default: cwd)
  --json               Machine-readable output (where supported)
  -h, --help
  -v, --version

Examples:
  opencode-studio serve --workspace ~/project
  opencode-studio serve --web
  opencode-studio status
  opencode-studio repair
  opencode-studio service install --workspace ~/project

Notes:
  serve binds 127.0.0.1 by default; --web needs OPENCODE_STUDIO_PASSWORD
  (optional OPENCODE_STUDIO_USERNAME, default opencode-studio).
  Skip postinstall setup: OPENCODE_STUDIO_SKIP_POSTINSTALL=1
`)
}

function printCommandHelp(command: string) {
  const texts: Record<string, string> = {
    serve: `opencode-studio serve [options]

Start the Studio viewer and OpenCode sidecar (foreground).

Options:
  --workspace <path>     Domain data root (default: cwd)
  --local                Bind 127.0.0.1 (default)
   --web                  Bind 0.0.0.0; requires OPENCODE_STUDIO_PASSWORD
                         (Basic user: OPENCODE_STUDIO_USERNAME or opencode-studio)
  --port <port>          Default 4173
  --ui-directory <path>  Override UI dist
  -h, --help
`,
    status: `opencode-studio status [options]

Package version, roots, skills, engines, and health checks.
Exit 0 if ok, 1 if any check fails.

Options:
  --workspace <path>
  --json
  -h, --help
`,
    repair: `opencode-studio repair [options]

Reinstall OpenCode plugins, CAD/PCB + media skills, and build123d MCP.
Also runs on global bun install. Use after remove, drift, or skipped postinstall.

Options:
  --workspace <path>   Domain data root (default: cwd)
  --dry-run
  --json
  -h, --help
`,
    remove: `opencode-studio remove [options]

Uninstall managed plugins, skills, and build123d MCP from OpenCode home.
Does not uninstall the global package (bun remove -g @oguzkaganozt/opencode-studio).

Options:
  --workspace <path>   Optional domain root for local scrub
  --json
  -h, --help
`,
    upgrade: `opencode-studio upgrade [options]

Install @oguzkaganozt/opencode-studio@latest via bun add -g.
Restarts the systemd user unit when present. Restart OpenCode after.

Options:
  --check              Report only (exit 1 if update available, 2 on error)
  --workspace <path>   When refreshing the unit
  --local | --web
  --port <port>
  --name <unit>
  --json
  -h, --help
`,
    service: `opencode-studio service <action> [options]

Linux systemd user unit for a background host.

Actions: ${SERVICE_ACTIONS.join("|")}

Options:
  --workspace <path>   Domain data root (install)
  --local | --web
  --port <port>
  --name <unit>        Default opencode-studio
  --json
  -h, --help
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
  return args.length === 1 && (args[0] === "-v" || args[0] === "--version")
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

  // Legacy aliases
  if (command === "configure") {
    console.error("opencode-studio configure is now: opencode-studio repair")
    return main(["repair", ...rest])
  }
  if (command === "doctor") {
    console.error("opencode-studio doctor is now: opencode-studio status")
    return main(["status", ...rest])
  }

  if (wantsHelp(rest)) {
    printCommandHelp(command)
    return 0
  }

  if (command === "repair") {
    let values: { workspace?: string; "dry-run"?: boolean; json?: boolean }
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          workspace: { type: "string" },
          "dry-run": { type: "boolean", default: false },
          json: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
      })
      values = parsed.values
    } catch (error) {
      return failParse("repair", error)
    }
    const result = await configureStudios({
      workspace: values.workspace,
      packageRoot,
      dryRun: values["dry-run"],
    })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(`Repaired (always on): ${result.enabled.join(", ")}`)
      if ("configPath" in result && result.configPath) console.log(`Config: ${result.configPath}`)
      console.log("Restart OpenCode to load plugins and skills.")
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
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(`Package: ${result.packageName}@${result.packageVersion}`)
      console.log(`Config: ${result.configPath}`)
      console.log(`Domain root: ${result.workspace}`)
      if (result.configError) console.log(`Config error: ${result.configError}`)
      console.log(`Studios (always on): ${result.enabled.join(", ")}`)
      for (const studio of result.studios) {
        const skill = studio.skillInstalled ? "skill ok" : "skill missing"
        console.log(`  ${studio.id}  root=${studio.root ?? studio.rootError ?? "?"}  (${skill})`)
      }
      console.log("Checks:")
      for (const check of result.checks) {
        console.log(`  ${check.status.padEnd(4)} ${check.id}: ${check.message}`)
        if (check.repair) console.log(`         → ${check.repair}`)
      }
      const needsRepairRestart = result.checks.some(
        (check) =>
          (check.status === "warn" || check.status === "fail") &&
          typeof check.repair === "string" &&
          check.repair.includes("opencode-studio repair") &&
          /^(plugin-|mcp-|skill:)/.test(check.id),
      )
      if (needsRepairRestart) console.log(`Tip: ${result.restartRequiredHint}`)
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
    else console.log("Removed managed plugins/skills/MCP. Restart OpenCode. Run repair to reinstall.")
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
    if (mode === "web") {
      const user = resolveBasicUsername()
      console.log(`auth: HTTP Basic  user=${user}  password=$OPENCODE_STUDIO_PASSWORD`)
      console.log(`      (override user with OPENCODE_STUDIO_USERNAME)`)
    }
    console.log("Tip: opencode-studio status · restart OpenCode after first install/repair")
    await new Promise(() => {})
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
