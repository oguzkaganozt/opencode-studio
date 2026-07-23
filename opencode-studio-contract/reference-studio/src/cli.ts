#!/usr/bin/env bun

import path from "node:path"
import { parseArgs } from "node:util"
import { doctorStudio, installStudio, removeStudio, type Scope } from "./lifecycle"
import { DEFAULT_PORT, loadPackageMeta, packageRootFrom } from "./manifest"
import { createReferenceStudioApp } from "./server"
import { canonicalDataRoot } from "./studio-path"

const USAGE = `Usage:
  opencode-reference-studio install [--scope user|project] [--dry-run] [--json] [--config-home PATH] [--project-root PATH]
  opencode-reference-studio remove  [--scope user|project] [--dry-run] [--json] [--config-home PATH] [--project-root PATH]
  opencode-reference-studio doctor  [--scope user|project] [--json] [--config-home PATH] [--project-root PATH] [--root PATH] [--companion-url URL]
  opencode-reference-studio serve --root PATH [--host HOST] [--port PORT] [--ui-directory PATH]

Options are command-specific. Human-readable output is the default.`

function printHelp() {
  console.log(USAGE)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function parseScope(value: string | undefined): Scope {
  if (value === undefined || value === "user") return "user"
  if (value === "project") return "project"
  fail(`Invalid --scope: ${value}`)
}

function emit(json: boolean, human: string, payload: unknown) {
  if (json) console.log(JSON.stringify(payload, null, 2))
  else console.log(human)
}

async function runLifecycle(command: "install" | "remove" | "doctor", args: string[]) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      scope: { type: "string", default: "user" },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      "config-home": { type: "string" },
      "project-root": { type: "string" },
      root: { type: "string" },
      "companion-url": { type: "string" },
      debug: { type: "boolean", default: false },
    },
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const packageRoot = packageRootFrom(import.meta.dir)
  const scope = parseScope(parsed.values.scope)
  const meta = await loadPackageMeta(packageRoot)
  const common = {
    packageRoot,
    scope,
    configHome: parsed.values["config-home"],
    projectRoot: parsed.values["project-root"],
  }

  try {
    if (command === "install") {
      const result = await installStudio({ ...common, dryRun: parsed.values["dry-run"] })
      emit(
        parsed.values.json,
        `${result.dryRun ? "Would install" : "Installed"} ${meta.packageName} (${scope}): plugin ${result.plugin}, skill ${result.paths.skillDirectory}`,
        result,
      )
      return
    }
    if (command === "remove") {
      const result = await removeStudio({ ...common, dryRun: parsed.values["dry-run"] })
      emit(
        parsed.values.json,
        `${result.dryRun ? "Would remove" : "Removed"} ${meta.packageName} (${scope}): plugin ${result.plugin}`,
        result,
      )
      return
    }
    const result = await doctorStudio({
      ...common,
      dataRoot: parsed.values.root,
      companionUrl: parsed.values["companion-url"],
    })
    emit(
      parsed.values.json,
      `doctor ${result.status}\n${result.checks.map((c) => `- [${c.status}] ${c.id}: ${c.message}`).join("\n")}`,
      result,
    )
    if (!result.ok) process.exit(1)
  } catch (error) {
    if (parsed.values.debug) throw error
    fail(error instanceof Error ? error.message : String(error))
  }
}

async function serveCompanion(args: string[]) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: String(DEFAULT_PORT) },
      "ui-directory": { type: "string" },
      help: { type: "boolean", default: false },
      debug: { type: "boolean", default: false },
    },
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  if (!parsed.values.root) fail("serve requires --root <path>")
  const port = Number(parsed.values.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail(`Invalid port: ${parsed.values.port}`)

  try {
    const packageRoot = packageRootFrom(import.meta.dir)
    const meta = await loadPackageMeta(packageRoot)
    const dataRoot = await canonicalDataRoot(parsed.values.root)
    const hostname = parsed.values.host ?? "127.0.0.1"
    const uiDirectory = parsed.values["ui-directory"] ?? path.join(packageRoot, "dist", "ui")
    const app = createReferenceStudioApp({
      dataRoot,
      hostname,
      port,
      studioId: meta.studioId,
      packageVersion: meta.packageVersion,
      contractVersion: meta.contractVersion,
      uiDirectory,
    })

    const server = Bun.serve({
      hostname,
      port,
      fetch: app.fetch,
    })

    console.log(`${meta.packageName} companion listening on http://${hostname}:${server.port}`)
    console.log("Data Root is read-only to the Companion. No application authentication is provided.")

    const shutdown = () => {
      server.stop(true)
      process.exit(0)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise(() => {})
  } catch (error) {
    if (parsed.values.debug) throw error
    fail(error instanceof Error ? error.message : String(error))
  }
}

const args = process.argv.slice(2)
const command = args[0]

if (!command || command === "--help" || command === "-h") {
  printHelp()
  process.exit(command ? 0 : 1)
}

if (command === "install" || command === "remove" || command === "doctor") {
  await runLifecycle(command, args)
} else if (command === "serve") {
  await serveCompanion(args)
} else {
  fail(USAGE)
}
