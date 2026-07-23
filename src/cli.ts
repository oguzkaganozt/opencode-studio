#!/usr/bin/env bun
import path from "node:path"
import { parseArgs } from "node:util"
import { resolveWorkspace } from "./core/paths"
import { assertLoopbackBind } from "./core/security"
import { configureStudios, doctorStudios, getPackageRoot, removeStudios, statusStudios } from "./lifecycle"
import { startHost } from "./server"

function printHelp() {
  console.log(`opencode-studio

Usage:
  opencode-studio configure <studio...> [--workspace <path>]
  opencode-studio status [--workspace <path>]
  opencode-studio doctor [--workspace <path>]
  opencode-studio serve [--workspace <path>] [--host <host>] [--port <port>] [--allow-non-loopback]
  opencode-studio remove [--workspace <path>]
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
      console.log(`Configured studios: ${result.enabled.join(", ") || "(none)"}`)
      console.log("Restart OpenCode and opencode-studio serve.")
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
      console.log(`Workspace: ${result.workspace}`)
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
    else console.log("Removed all Studios from this workspace. Restart OpenCode and the host.")
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
