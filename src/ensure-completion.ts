#!/usr/bin/env bun
/** Postinstall helper — not a public CLI command. */
import { ensureShellCompletions } from "./completion-install"
import { packageRootFrom } from "./core/paths"

const quiet = process.argv.includes("--quiet") || process.argv.includes("-q")
const result = await ensureShellCompletions({
  packageRoot: packageRootFrom(import.meta.dir),
  shells: ["bash", "zsh"],
})
if (result.skipped) {
  if (!quiet) console.log(`[opencode-studio] completion skipped: ${result.reason ?? "unknown"}`)
  process.exit(0)
}
if (result.migrated.length > 0) {
  console.log(`[opencode-studio] shell completion migrated → ${result.migrated.join(", ")}`)
}
if (result.updated.length > 0) {
  console.log(`[opencode-studio] shell completion → ${result.updated.join(", ")}`)
}
process.exit(0)
