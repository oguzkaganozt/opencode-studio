#!/usr/bin/env bun

import path from "node:path"
import { parseArgs } from "node:util"
import { doctorStudio, installStudio, removeStudio, type Scope } from "./lifecycle"
import { DEFAULT_PORT, loadPackageMeta, packageRootFrom } from "./package-meta"
import { createPcbStudioApp } from "./server"
import { canonicalWorkspaceRoot } from "./studio-path"

const USAGE = `Usage:
  opencode-pcb-studio install [--scope user|project] [--dry-run] [--json] [--config-home PATH] [--project-root PATH]
  opencode-pcb-studio remove  [--scope user|project] [--dry-run] [--json] [--config-home PATH] [--project-root PATH]
  opencode-pcb-studio doctor  [--scope user|project] [--json] [--config-home PATH] [--project-root PATH] [--root PATH] [--companion-url URL]
  opencode-pcb-studio serve --root PATH [--host HOST] [--port PORT] [--ui-directory PATH]

Options are command-specific. Human-readable output is the default.
Deprecated aliases: --workspace → --root.`

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

export function resolveCompanionRoot(rawRoot: string | undefined, cwd = process.cwd()): string {
  if (!rawRoot) throw new Error("serve requires --root <path>")
  return path.resolve(cwd, rawRoot)
}

async function serveCompanion(
  args: string[],
  dependencies: { uiDirectory?: string; log?: (message: string) => void; warn?: (message: string) => void } = {},
) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      workspace: { type: "string" },
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

  const root = parsed.values.root ?? parsed.values.workspace
  if (!root) fail("serve requires --root <path>")
  if (!parsed.values.root && parsed.values.workspace) {
    ;(dependencies.warn ?? console.warn)("Warning: --workspace is deprecated; use --root")
  }

  const port = Number(parsed.values.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail(`Invalid port: ${parsed.values.port}`)

  try {
    const packageRoot = packageRootFrom(import.meta.dir)
    const meta = await loadPackageMeta(packageRoot)
    const workspaceRoot = await canonicalWorkspaceRoot(resolveCompanionRoot(root))
    const hostname = parsed.values.host ?? "127.0.0.1"
    const uiDirectory =
      dependencies.uiDirectory ??
      parsed.values["ui-directory"] ??
      (path.basename(import.meta.dir) === "dist" ? path.resolve(import.meta.dir, "ui") : path.resolve(import.meta.dir, "../dist/ui"))

    const app = createPcbStudioApp({
      workspaceRoot,
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
      idleTimeout: 255,
      fetch: app.fetch,
    })

    const log = dependencies.log ?? console.log
    const warn = dependencies.warn ?? console.warn
    log(`${meta.packageName} companion listening on http://${server.hostname}:${server.port}`)
    warn("Warning: this server has no application authentication; expose it only on localhost or through a trusted VPN.")
    log(`Data Root: ${workspaceRoot}`)

    let closed = false
    return {
      server,
      workspaceRoot,
      async shutdown() {
        if (closed) return
        closed = true
        server.stop(true)
      },
    }
  } catch (error) {
    if (parsed.values.debug) throw error
    fail(error instanceof Error ? error.message : String(error))
  }
}

export async function startStudioCli(args: string[], dependencies: { uiDirectory?: string } = {}) {
  const command = args[0]

  if (!command || command === "--help" || command === "-h") {
    if (!command) fail(USAGE)
    printHelp()
    return
  }

  if (command === "install" || command === "remove" || command === "doctor") {
    return runLifecycle(command, args)
  }
  if (command === "serve") {
    return serveCompanion(args, dependencies)
  }
  fail(USAGE)
}

if (import.meta.main) {
  try {
    const result = await startStudioCli(Bun.argv.slice(2))
    if (result && typeof result === "object" && "shutdown" in result) {
      const shutdown = async () => {
        await result.shutdown()
        process.exit(0)
      }
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
