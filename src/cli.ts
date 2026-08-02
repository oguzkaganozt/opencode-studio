#!/usr/bin/env bun
import { type ParseArgsConfig, parseArgs } from "node:util"
import { loadPackageMeta } from "./core/package-meta"
import { resetStudioHostEnsureForTests } from "./host-ensure"
import { configureStudios, getPackageRoot, removeStudios, statusStudios } from "./lifecycle"
import { checkPackageUpgrade, upgradePackage } from "./package-upgrade"
import { defaultStudioRoot, runEnsureHostLoop } from "./serve-bootstrap"

type ParseFail = { ok: false; code: 2 }
type ParseOk<T> = { ok: true; values: T }

function parseCmd<T extends ParseArgsConfig["options"]>(
  command: string,
  rest: string[],
  options: T,
): ParseOk<ReturnType<typeof parseArgs<{ options: T }>>["values"]> | ParseFail {
  try {
    const parsed = parseArgs({
      args: rest,
      options,
      allowPositionals: false,
      strict: true,
    })
    return { ok: true, values: parsed.values }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    printCommandHelp(command)
    return { ok: false, code: 2 }
  }
}

function printHelp() {
  console.log(`opencode-studio

CAD and PCB are always on. Global install wires OpenCode once
(plugins, skills, MCP). Studio UI starts in-process when you run
opencode serve and a directory Instance loads.

Commands:
  status     Health, roots, skills (exit 1 if broken)
  repair     Reinstall plugins, skills, MCP
  ensure-host  Start fixed-root Studio host for a running opencode serve
  remove     Uninstall managed OpenCode state (package stays)
  upgrade    bun add -g @latest

Flags:
  --workspace <path>   Studio Home override for status/repair (default: $HOME)
  --json               Machine-readable output (where supported)
  -h, --help
  -v, --version

Examples:
  opencode-studio repair
  opencode-studio status --workspace /abs/project
  opencode serve          # → http://127.0.0.1:4173/studio

Notes:
  Studio host starts with opencode serve (ensure-host companion / plugin bootstrap);
  Studio Home is fixed to $HOME for the serve lifetime; OpenCode projects are request-scoped.
  Greenfield: always repair (postinstall is soft).
  Skip postinstall setup: OPENCODE_STUDIO_SKIP_POSTINSTALL=1
`)
}

function printCommandHelp(command: string) {
  const texts: Record<string, string> = {
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
  --workspace <path>   Studio Home override (default: $HOME)
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
Restart OpenCode after so plugins reload.

Options:
  --check              Report only (exit 1 if update available, 2 on error)
  --json
  -h, --help
`,
    "ensure-host": `opencode-studio ensure-host

Attach a fixed-root Studio host to a running opencode serve (default Studio Home $HOME).
Used by the opencode PATH wrapper
installed on repair so \`opencode serve\` brings up :4173 automatically.
Exits when parent OpenCode goes away.

Options:
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

async function main(argv: string[]) {
  if (argv.length === 0 || (argv.length === 1 && wantsHelp(argv))) {
    printHelp()
    return 0
  }
  if (wantsVersion(argv)) {
    const meta = await loadPackageMeta(getPackageRoot())
    console.log(meta.version)
    return 0
  }

  const [command, ...rest] = argv
  if (wantsHelp(rest)) {
    printCommandHelp(command)
    return 0
  }

  const packageRoot = getPackageRoot()

  if (command === "status") {
    const parsed = parseCmd(command, rest, {
      workspace: { type: "string" },
      json: { type: "boolean", default: false },
    })
    if (!parsed.ok) return parsed.code
    const values = parsed.values
    const result = await statusStudios({ workspace: values.workspace ?? defaultStudioRoot(), packageRoot })
    if (values.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`Package: ${result.packageName}@${result.packageVersion}`)
      console.log(`Config: ${result.configPath}`)
      if (result.configError) console.log(`Config error: ${result.configError}`)
      console.log(`Studio Home: ${result.workspace}`)
      console.log(`Studios (always on): ${result.enabled.join(", ")}`)
      for (const studio of result.studios) {
        const skill = studio.skillInstalled ? "skill ok" : "skill missing"
        const root = studio.root ?? studio.rootError ?? "?"
        console.log(`  ${studio.id}  root=${root}  (${skill})`)
      }
      console.log("Checks:")
      for (const check of result.checks) {
        const repair = typeof check.repair === "string" && check.repair.length > 0 ? ` — ${check.repair}` : ""
        console.log(`  ${check.status} ${check.id}: ${check.message}${repair}`)
      }
      if (!result.ok) {
        const needsRepairRestart = result.checks.some(
          (check) =>
            (check.status === "warn" || check.status === "fail") &&
            typeof check.repair === "string" &&
            check.repair.includes("opencode-studio repair") &&
            /^(plugin-|mcp-|skill:)/.test(check.id),
        )
        if (needsRepairRestart) console.log(`Tip: ${result.restartRequiredHint}`)
      }
    }
    return result.ok ? 0 : 1
  }

  if (command === "repair") {
    const parsed = parseCmd(command, rest, {
      workspace: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    })
    if (!parsed.ok) return parsed.code
    const values = parsed.values
    const result = await configureStudios({
      workspace: values.workspace ?? defaultStudioRoot(),
      packageRoot,
      dryRun: values["dry-run"],
    })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(
        values["dry-run"] ? `Dry run OK (always on): ${result.enabled.join(", ")}` : `Repaired (always on): ${result.enabled.join(", ")}`,
      )
      console.log(`Config: ${result.configPath}`)
      if (!values["dry-run"]) console.log("Restart OpenCode to load plugins and skills.")
    }
    return 0
  }

  if (command === "ensure-host") {
    const stop = () => {
      resetStudioHostEnsureForTests()
      process.exit(0)
    }
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
    try {
      await runEnsureHostLoop({ packageRoot })
      resetStudioHostEnsureForTests()
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      resetStudioHostEnsureForTests()
      return 1
    }
  }

  if (command === "remove") {
    const parsed = parseCmd(command, rest, {
      workspace: { type: "string" },
      json: { type: "boolean", default: false },
    })
    if (!parsed.ok) return parsed.code
    const values = parsed.values
    const result = await removeStudios({ workspace: values.workspace, packageRoot })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else console.log("Removed managed plugins/skills/MCP. Restart OpenCode. Run repair to reinstall.")
    return 0
  }

  if (command === "upgrade") {
    const parsed = parseCmd(command, rest, {
      check: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    })
    if (!parsed.ok) return parsed.code
    const values = parsed.values

    if (values.check) {
      const result = await checkPackageUpgrade({ packageRoot })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else console.log(result.message)
      if (result.error && !result.latest) return 2
      return result.updateAvailable ? 1 : 0
    }

    try {
      const result = await upgradePackage({ packageRoot })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else console.log(result.message)
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (command === "serve" || command === "service") {
    console.error(`'${command}' was removed. Run: opencode serve`)
    console.error("Studio host starts via ensure-host (PATH wrapper on repair) or plugin bootstrap.")
    return 2
  }

  console.error(`Unknown command: ${command}`)
  printHelp()
  return 2
}

try {
  const code = await main(process.argv.slice(2))
  process.exit(code)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
