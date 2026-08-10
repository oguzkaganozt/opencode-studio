#!/usr/bin/env bun
import { createInterface } from "node:readline"
import { type ParseArgsConfig, parseArgs } from "node:util"
import { normalizeCliArgs } from "./cli-args"
import { loadPackageMeta } from "./core/package-meta"
import { stopOwnedStudioHost } from "./host-ensure"
import { configureStudios, getPackageRoot, removeStudios, statusStudios } from "./lifecycle"
import { stopOwnedOpenCode } from "./opencode-supervisor"
import { checkPackageUpgrade, upgradeAndRestart } from "./package-upgrade"
import { defaultStudioRoot, runEnsureHostLoop, runStudioUp } from "./serve-bootstrap"

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

CAD and PCB studios + native Agent panel on OpenCode.
Default path supervises OpenCode API and serves Studio on one URL.

Commands:
  up         Start OpenCode (spawn/attach) + Studio host (primary)
  status     Health, roots, skills (exit 1 if broken)
  repair     Reinstall plugins, skills, MCP
  ensure-host  Studio host only (legacy companion for external serve)
  remove     Uninstall managed OpenCode state (package stays)
  upgrade    Check npm, confirm, install @latest, restart stack

Flags:
  --workspace <path>   Studio Home override for status/repair (default: $HOME)
  --json               Machine-readable output (where supported)
  -y, --yes            Confirm upgrade without a prompt
  -h, --help
  -v, --version

Examples:
  opencode-studio         # same as up
  opencode-studio up      # → http://127.0.0.1:4173/studio
  opencode-studio repair
  opencode-studio status

Notes:
  OPENCODE_URL / existing serve → attach; else spawn opencode serve on loopback.
  OPENCODE_STUDIO_NO_SUPERVISE=1 disables spawn (attach-only).
  Studio Home defaults to $HOME; agent directory follows the open project.
  Greenfield: always repair (postinstall is soft).
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

Reinstall OpenCode plugins and CAD/PCB + media skills.
Also runs on global bun install. Use after remove, drift, or skipped postinstall.

Options:
  --workspace <path>   Studio Home override (default: $HOME)
  --dry-run
  --json
  -h, --help
`,
    remove: `opencode-studio remove [options]

Uninstall managed plugins and skills from OpenCode home (also scrubs legacy build123d MCP).
Does not uninstall the global package (bun remove -g @oguzkaganozt/opencode-studio).

Options:
  --workspace <path>   Optional domain root for local scrub
  --json
  -h, --help
`,
    upgrade: `opencode-studio upgrade [options]

If a newer version is on npm: ask, then stop the owned Studio stack, install @latest,
repair plugins/skills/MCP, and restart opencode-studio up.

Options:
  --check              Report only (exit 1 if update available, 2 on error)
  -y, --yes            Skip the confirmation prompt
  --json
  -h, --help
`,
    up: `opencode-studio up

Primary entry: ensure OpenCode API (attach or spawn), start Studio host, keep running.
Open http://127.0.0.1:4173/studio (or OPENCODE_STUDIO_PORT).

Options:
  -h, --help
`,
    "ensure-host": `opencode-studio ensure-host

Legacy companion: attach Studio host to OpenCode (spawns OC if missing unless NO_SUPERVISE).
Prefer: opencode-studio up

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

function askYesNo(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

async function main(argv: string[]) {
  const args = normalizeCliArgs(argv)
  if (args.length === 1 && wantsHelp(args)) {
    printHelp()
    return 0
  }
  if (wantsVersion(args)) {
    const meta = await loadPackageMeta(getPackageRoot())
    console.log(meta.version)
    return 0
  }

  const [command, ...rest] = args
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

  if (command === "up") {
    const parsed = parseCmd(command, rest, {})
    if (!parsed.ok) return parsed.code
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      void (async () => {
        stopOwnedStudioHost()
        await stopOwnedOpenCode({ permanent: true })
        process.exit(0)
      })()
    }
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
    try {
      const result = await runStudioUp({ packageRoot })
      if (!result.ok) {
        console.error(result.reason)
        await stopOwnedOpenCode({ permanent: true })
        return 1
      }
      console.log(result.studioUrl)
      // Stay alive while host + supervised OC run
      await new Promise(() => {})
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      stopOwnedStudioHost()
      await stopOwnedOpenCode({ permanent: true })
      return 1
    }
  }

  if (command === "ensure-host") {
    const parsed = parseCmd(command, rest, {})
    if (!parsed.ok) return parsed.code
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      void (async () => {
        stopOwnedStudioHost()
        await stopOwnedOpenCode({ permanent: true })
        process.exit(0)
      })()
    }
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
    try {
      await runEnsureHostLoop({ packageRoot })
      stopOwnedStudioHost()
      await stopOwnedOpenCode({ permanent: true })
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      stopOwnedStudioHost()
      await stopOwnedOpenCode({ permanent: true })
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
      yes: { type: "boolean", short: "y", default: false },
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
      const check = await checkPackageUpgrade({ packageRoot })
      if (!check.updateAvailable || !check.latest) {
        if (values.json) console.log(JSON.stringify(check, null, 2))
        else console.log(check.message)
        return check.error && !check.latest ? 2 : 0
      }

      if (!values.yes) {
        console.error(`Update available: ${check.current} → ${check.latest}`)
        console.error("This will stop the owned OpenCode Studio stack, install the new package,")
        console.error("repair plugins/skills/MCP, then restart opencode-studio up.")
        if (!process.stdin.isTTY) {
          console.error("Non-interactive shell: re-run with --yes to confirm.")
          return 2
        }
        const ok = await askYesNo("Install and restart? [y/N] ")
        if (!ok) {
          console.error("Cancelled.")
          return 0
        }
      }

      const result = await upgradeAndRestart({
        packageRoot,
        onProgress: (line) => console.error(`→ ${line}`),
      })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else console.log(result.message)
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (command === "serve" || command === "service") {
    console.error(`'${command}' was removed. Prefer: opencode-studio up`)
    console.error("Legacy: opencode serve + opencode-studio ensure-host")
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
