#!/usr/bin/env node
/**
 * Global install postinstall (never fails the install):
 * 1) repair — OpenCode plugins, skills, build123d MCP
 * 2) shell completion — static scripts under ~/.config/opencode-studio/
 *
 * Skip all: OPENCODE_STUDIO_SKIP_POSTINSTALL=1
 * Skip repair: OPENCODE_STUDIO_SKIP_CONFIGURE=1
 * Skip completion: OPENCODE_STUDIO_SKIP_COMPLETION=1
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cli = path.join(root, "dist", "cli.js")
const ensureCompletion = path.join(root, "dist", "ensure-completion.js")
const REPAIR_TIMEOUT_MS = 30_000
const COMPLETION_TIMEOUT_MS = 8_000

/** @param {NodeJS.ProcessEnv} [env] */
export function shouldRunPostinstall(env = process.env) {
  if (env.OPENCODE_STUDIO_SKIP_POSTINSTALL === "1" || env.OPENCODE_STUDIO_SKIP_POSTINSTALL === "true") {
    return { ok: false, reason: "OPENCODE_STUDIO_SKIP_POSTINSTALL" }
  }
  if (env.CI === "true" || env.CI === "1") {
    return { ok: false, reason: "CI" }
  }
  const globalFlag = env.npm_config_global
  if (globalFlag === "true" || globalFlag === "1") return { ok: true }
  if (env.npm_config_argv?.includes('"global":true') || env.npm_config_argv?.includes("--global")) {
    return { ok: true }
  }
  return { ok: false, reason: "not a global install" }
}

/** @param {NodeJS.ProcessEnv} [env] */
export function shouldRunPostinstallCompletion(env = process.env) {
  if (env.OPENCODE_STUDIO_SKIP_COMPLETION === "1" || env.OPENCODE_STUDIO_SKIP_COMPLETION === "true") {
    return { ok: false, reason: "OPENCODE_STUDIO_SKIP_COMPLETION" }
  }
  return shouldRunPostinstall(env)
}

/** @param {NodeJS.ProcessEnv} [env] */
export function shouldRunPostinstallConfigure(env = process.env) {
  if (env.OPENCODE_STUDIO_SKIP_CONFIGURE === "1" || env.OPENCODE_STUDIO_SKIP_CONFIGURE === "true") {
    return { ok: false, reason: "OPENCODE_STUDIO_SKIP_CONFIGURE" }
  }
  return shouldRunPostinstall(env)
}

function hasBun() {
  return spawnSync("bun", ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 3_000 }).status === 0
}

/** @param {string[]} args @param {number} timeoutMs */
function runBun(args, timeoutMs) {
  return spawnSync("bun", args, {
    encoding: "utf8",
    env: process.env,
    cwd: root,
    timeout: timeoutMs,
  })
}

function main() {
  if (!hasBun()) {
    console.warn("[opencode-studio] bun not on PATH; skip postinstall. Later run: opencode-studio repair")
    return
  }

  if (shouldRunPostinstallConfigure().ok && existsSync(cli)) {
    const result = runBun([cli, "repair", "--json"], REPAIR_TIMEOUT_MS)
    if (result.error?.code === "ETIMEDOUT") {
      console.warn("[opencode-studio] repair timed out; run: opencode-studio repair")
    } else if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim()
      console.warn(`[opencode-studio] repair on install skipped${detail ? `: ${detail.split("\n")[0]}` : ""}. Run: opencode-studio repair`)
    } else {
      console.log("[opencode-studio] OpenCode plugins and skills installed. Restart OpenCode to load them.")
    }
  }

  if (shouldRunPostinstallCompletion().ok && existsSync(ensureCompletion)) {
    const result = runBun([ensureCompletion], COMPLETION_TIMEOUT_MS)
    if (result.error?.code === "ETIMEDOUT") {
      console.warn("[opencode-studio] completion install timed out")
    } else {
      if (result.stdout?.trim()) console.log(result.stdout.trimEnd())
      if (result.stderr?.trim()) console.warn(result.stderr.trimEnd())
    }
  }
}

try {
  main()
} catch (error) {
  console.warn("[opencode-studio] postinstall skipped:", error instanceof Error ? error.message : error)
}
