#!/usr/bin/env bun

import path from "node:path"
import { parseArgs } from "node:util"
import { type DeploymentDependencies, generateSystemdUnit, installService, updateService } from "./deployment"
import { resolveExistingLibraryRoot } from "./library"
import { doctorStudio, installStudio, removeStudio, type Scope } from "./lifecycle"
import { DEFAULT_PORT, loadPackageMeta, packageRootFrom } from "./package-meta"
import { createMediaStudioApp } from "./server"
import { createVersionProvider } from "./version"

const USAGE = `Usage:
  opencode-media-studio install [--scope user|project] [--dry-run] [--json] [--config-home PATH] [--project-root PATH]
  opencode-media-studio remove  [--scope user|project] [--dry-run] [--json] [--config-home PATH] [--project-root PATH]
  opencode-media-studio doctor  [--scope user|project] [--json] [--config-home PATH] [--project-root PATH] [--root PATH] [--companion-url URL]
  opencode-media-studio serve --root PATH [--host HOST] [--port PORT] [--ui-directory PATH]
  opencode-media-studio service-install [--directory PATH] [--host HOST] [--port PORT]
                                        [--user USER] [--group GROUP] [--no-service] [--dry-run]
  opencode-media-studio service-update [--version VERSION] [--dry-run]

Options are command-specific. Human-readable output is the default.
Deprecated aliases: --directory → --root.`

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

export function managedInstallRootFromModule(modulePath: string) {
  const absolute = path.resolve(modulePath)
  const parsed = path.parse(absolute)
  const parts = absolute.slice(parsed.root.length).split(path.sep)
  const releases = parts.lastIndexOf("releases")
  if (
    releases < 0 ||
    parts[releases + 2] !== "node_modules" ||
    parts[releases + 3] !== "opencode-media-studio" ||
    parts[releases + 4] !== "dist"
  )
    return
  return path.join(parsed.root, ...parts.slice(0, releases))
}

export { generateSystemdUnit, installService, updateService }

export function resolveCompanionRoot(rawRoot: string | undefined, cwd = process.cwd()): string {
  if (!rawRoot) throw new Error("serve requires --root <path>")
  return path.resolve(cwd, rawRoot)
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

async function serveCompanion(
  args: string[],
  dependencies: {
    uiDirectory?: string
    log?: (message: string) => void
    warn?: (message: string) => void
  } = {},
) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      directory: { type: "string" },
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

  const root = parsed.values.root ?? parsed.values.directory
  if (!root) fail("serve requires --root <path>")
  if (!parsed.values.root && parsed.values.directory) {
    ;(dependencies.warn ?? console.warn)("Warning: --directory is deprecated; use --root")
  }

  const port = Number(parsed.values.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail(`Invalid port: ${parsed.values.port}`)

  try {
    const packageRoot = packageRootFrom(import.meta.dir)
    const meta = await loadPackageMeta(packageRoot)
    const libraryRoot = await resolveExistingLibraryRoot({ root: resolveCompanionRoot(root) })
    const hostname = parsed.values.host ?? "127.0.0.1"
    const uiDirectory =
      dependencies.uiDirectory ??
      parsed.values["ui-directory"] ??
      (path.basename(import.meta.dir) === "dist" ? path.resolve(import.meta.dir, "ui") : path.resolve(import.meta.dir, "../dist/ui"))
    const configuredScope = process.env.OPENCODE_MEDIA_STUDIO_INSTALL_SCOPE
    const scope =
      configuredScope === "system" || configuredScope === "user" ? configuredScope : process.getuid?.() === 0 ? "system" : "user"
    const app = createMediaStudioApp({
      root: libraryRoot,
      hostname,
      port,
      studioId: meta.studioId,
      packageVersion: meta.packageVersion,
      contractVersion: meta.contractVersion,
      uiDirectory,
      versionProvider: createVersionProvider({
        installRoot: process.env.OPENCODE_MEDIA_STUDIO_INSTALL_ROOT ?? managedInstallRootFromModule(import.meta.path),
        scope,
      }),
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
    log(`Library root: ${libraryRoot}`)

    let closed = false
    return {
      server,
      root: libraryRoot,
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

export async function startMediaStudioCli(
  args: string[],
  dependencies: DeploymentDependencies & {
    uiDirectory?: string
    log?: (message: string) => void
    warn?: (message: string) => void
  } = {},
) {
  const command = args[0]

  if (!command || command === "--help" || command === "-h") {
    if (!command) fail(USAGE)
    printHelp()
    return
  }

  if (command === "install" || command === "remove" || command === "doctor") {
    return runLifecycle(command, args)
  }
  if (command === "service-install") {
    const rewritten = [...args]
    rewritten[0] = "install"
    return installService(rewritten, dependencies)
  }
  if (command === "service-update") {
    const rewritten = [...args]
    rewritten[0] = "update"
    return updateService(rewritten, dependencies)
  }
  if (command === "serve") {
    return serveCompanion(args, dependencies)
  }
  fail(USAGE)
}

export const startStudioCli = startMediaStudioCli

if (import.meta.main) {
  try {
    const result = await startMediaStudioCli(Bun.argv.slice(2))
    if (result && typeof result === "object" && "shutdown" in result) {
      const shutdown = async () => {
        await (result as { shutdown: () => Promise<void> }).shutdown()
        process.exit(0)
      }
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    } else if (result !== undefined) {
      process.exit(0)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
