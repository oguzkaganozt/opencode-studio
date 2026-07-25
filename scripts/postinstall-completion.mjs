#!/usr/bin/env node
/**
 * Runs after npm/bun install. Only acts on *global* installs.
 * Never fails the install — completion is best-effort.
 *
 * Skip: OPENCODE_STUDIO_SKIP_COMPLETION=1
 * Gate logic mirrors src/completion-install.ts#shouldRunPostinstallCompletion
 * (kept as plain node so postinstall works before bun is required for the CLI body).
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cli = path.join(root, "dist", "cli.js")
const INSTALL_TIMEOUT_MS = 8_000

/** @param {NodeJS.ProcessEnv} [env] */
export function shouldRunPostinstallCompletion(env = process.env) {
  if (env.OPENCODE_STUDIO_SKIP_COMPLETION === "1" || env.OPENCODE_STUDIO_SKIP_COMPLETION === "true") {
    return { ok: false, reason: "OPENCODE_STUDIO_SKIP_COMPLETION" }
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

function hasBun() {
  return spawnSync("bun", ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 3_000 }).status === 0
}

function main() {
  const gate = shouldRunPostinstallCompletion()
  if (!gate.ok) return
  if (!existsSync(cli)) return
  if (!hasBun()) {
    console.warn("[opencode-studio] bun not on PATH; skip auto completion. Later run: opencode-studio completion install")
    return
  }
  const result = spawnSync("bun", [cli, "completion", "install", "--quiet"], {
    encoding: "utf8",
    env: process.env,
    cwd: root,
    timeout: INSTALL_TIMEOUT_MS,
  })
  if (result.error?.code === "ETIMEDOUT") {
    console.warn("[opencode-studio] completion install timed out; run: opencode-studio completion install")
    return
  }
  if (result.stdout?.trim()) console.log(result.stdout.trimEnd())
  if (result.stderr?.trim()) console.warn(result.stderr.trimEnd())
}

try {
  main()
} catch (error) {
  console.warn("[opencode-studio] completion postinstall skipped:", error instanceof Error ? error.message : error)
}
