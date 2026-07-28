import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { bashCompletionScript, zshCompletionScript } from "./completion"
import { packageRootFrom } from "./core/paths"

export const COMPLETION_MARKER = "opencode-studio-completion"

/** Old CLI-based install (removed). Must be rewritten to source form. */
export const LEGACY_COMPLETION_EVAL = /eval\s+"\$\(opencode-studio\s+completion\s+(bash|zsh)\)"/

export function completionConfigDir(home = os.homedir()) {
  return path.join(home, ".config", "opencode-studio")
}

export function completionScriptPath(shell: "bash" | "zsh", home = os.homedir()) {
  return path.join(completionConfigDir(home), `completion.${shell}`)
}

/** Rc source line — static script written by postinstall. */
export function completionLine(shell: "bash" | "zsh", home = os.homedir()): string {
  return `source "${completionScriptPath(shell, home)}"  # ${COMPLETION_MARKER}`
}

export type ShellRc = {
  shell: "bash" | "zsh"
  rcPath: string
  line: string
}

/** Rc files we may update for the current user. */
export function candidateRcFiles(home = os.homedir()): ShellRc[] {
  return [
    { shell: "bash", rcPath: path.join(home, ".bashrc"), line: completionLine("bash", home) },
    { shell: "zsh", rcPath: path.join(home, ".zshrc"), line: completionLine("zsh", home) },
  ]
}

/** True when rc already has the current static-source form for this shell. */
export function rcHasCurrentCompletion(content: string, shell: "bash" | "zsh", home = os.homedir()): boolean {
  const expected = completionLine(shell, home)
  if (content.includes(expected)) return true
  // Same path, optional whitespace around marker
  const escaped = completionScriptPath(shell, home).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`source\\s+["']${escaped}["']`).test(content)
}

/** True when rc still uses the removed `opencode-studio completion` CLI. */
export function rcHasLegacyCompletion(content: string): boolean {
  return LEGACY_COMPLETION_EVAL.test(content) || /opencode-studio completion (bash|zsh)/.test(content)
}

/**
 * Replace legacy eval/CLI completion lines with the static source line.
 * Removes adjacent `# opencode-studio-completion` comment-only lines left behind.
 */
export function migrateLegacyCompletionRc(content: string, shell: "bash" | "zsh", home = os.homedir()): string {
  if (!rcHasLegacyCompletion(content)) return content
  const nextLine = completionLine(shell, home)
  const lines = content.split("\n")
  const out: string[] = []
  let replaced = false
  for (const line of lines) {
    if (LEGACY_COMPLETION_EVAL.test(line) || /opencode-studio completion (bash|zsh)/.test(line)) {
      if (!replaced) {
        out.push(nextLine)
        replaced = true
      }
      continue
    }
    // Drop standalone marker comments that only annotated the old eval block
    if (line.trim() === `# ${COMPLETION_MARKER}` && replaced) continue
    out.push(line)
  }
  if (!replaced && rcHasLegacyCompletion(content)) {
    // Fallback: append if pattern matched in a way line scan missed
    const prefix = content.length === 0 || content.endsWith("\n") ? "" : "\n"
    return `${content}${prefix}${nextLine}\n`
  }
  return out.join("\n")
}

export type EnsureCompletionResult = {
  skipped: boolean
  reason?: string
  updated: string[]
  already: string[]
  missing: string[]
  migrated: string[]
  scripts?: string[]
}

/**
 * Write static completion scripts under ~/.config/opencode-studio/ and
 * append or migrate source lines in shell rc files.
 */
export async function ensureShellCompletions(input?: {
  home?: string
  packageRoot?: string
  onlyExisting?: boolean
  shells?: Array<"bash" | "zsh">
}): Promise<EnsureCompletionResult> {
  const home = input?.home ?? os.homedir()
  const onlyExisting = input?.onlyExisting ?? true
  const updated: string[] = []
  const already: string[] = []
  const missing: string[] = []
  const migrated: string[] = []
  const scripts: string[] = []

  if (!home) {
    return { skipped: true, reason: "no HOME", updated, already, missing, migrated }
  }

  let bashBody = bashCompletionScript()
  let zshBody = zshCompletionScript()
  const root = input?.packageRoot ?? packageRootFrom(import.meta.dir)
  try {
    const packagedBash = path.join(root, "dist", "completion.bash")
    const packagedZsh = path.join(root, "dist", "completion.zsh")
    if (await Bun.file(packagedBash).exists()) bashBody = await readFile(packagedBash, "utf8")
    if (await Bun.file(packagedZsh).exists()) zshBody = await readFile(packagedZsh, "utf8")
  } catch {
    // fall back to generated bodies
  }

  await mkdir(completionConfigDir(home), { recursive: true, mode: 0o755 })
  const bashPath = completionScriptPath("bash", home)
  const zshPath = completionScriptPath("zsh", home)
  await writeFile(bashPath, bashBody, { mode: 0o644 })
  await writeFile(zshPath, zshBody, { mode: 0o644 })
  scripts.push(bashPath, zshPath)

  const shells = input?.shells ?? preferredShells(process.env.SHELL)
  const candidates = candidateRcFiles(home).filter((c) => shells.includes(c.shell))

  for (const candidate of candidates) {
    let exists = false
    try {
      await access(candidate.rcPath)
      exists = true
    } catch {
      exists = false
    }

    if (!exists) {
      if (onlyExisting) {
        missing.push(candidate.rcPath)
        continue
      }
      try {
        await mkdir(path.dirname(candidate.rcPath), { recursive: true })
        await appendFile(candidate.rcPath, `${candidate.line}\n`, "utf8")
        updated.push(candidate.rcPath)
      } catch {
        missing.push(candidate.rcPath)
      }
      continue
    }

    try {
      const content = await readFile(candidate.rcPath, "utf8")

      if (rcHasLegacyCompletion(content)) {
        const next = migrateLegacyCompletionRc(content, candidate.shell, home)
        if (next !== content) {
          await writeFile(candidate.rcPath, next, "utf8")
          migrated.push(candidate.rcPath)
          continue
        }
      }

      if (rcHasCurrentCompletion(content, candidate.shell, home)) {
        already.push(candidate.rcPath)
        continue
      }

      const prefix = content.length === 0 || content.endsWith("\n") ? "" : "\n"
      await appendFile(candidate.rcPath, `${prefix}\n# ${COMPLETION_MARKER}\n${candidate.line}\n`, "utf8")
      updated.push(candidate.rcPath)
    } catch {
      missing.push(candidate.rcPath)
    }
  }

  return { skipped: false, updated, already, missing, migrated, scripts }
}

export function preferredShells(shellPath?: string): Array<"bash" | "zsh"> {
  const base = path.basename(shellPath ?? "")
  if (base === "zsh") return ["zsh"]
  if (base === "bash") return ["bash"]
  return ["bash", "zsh"]
}

function isBunGlobalPackageRoot(packageRoot: string) {
  return packageRoot.replace(/\\/g, "/").includes("/.bun/install/global/")
}

export function shouldRunPostinstallCompletion(env: NodeJS.ProcessEnv = process.env, packageRoot = ""): { ok: boolean; reason?: string } {
  if (env.OPENCODE_STUDIO_SKIP_COMPLETION === "1" || env.OPENCODE_STUDIO_SKIP_COMPLETION === "true") {
    return { ok: false, reason: "OPENCODE_STUDIO_SKIP_COMPLETION" }
  }
  if (env.OPENCODE_STUDIO_SKIP_POSTINSTALL === "1" || env.OPENCODE_STUDIO_SKIP_POSTINSTALL === "true") {
    return { ok: false, reason: "OPENCODE_STUDIO_SKIP_POSTINSTALL" }
  }
  if (env.CI === "true" || env.CI === "1") {
    return { ok: false, reason: "CI" }
  }
  if (packageRoot && isBunGlobalPackageRoot(packageRoot)) return { ok: true }
  return { ok: false, reason: "not a bun global install" }
}
