import { access, appendFile, mkdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const COMPLETION_MARKER = "opencode-studio-completion"

export type ShellRc = {
  shell: "bash" | "zsh"
  rcPath: string
  line: string
}

export function completionLine(shell: "bash" | "zsh"): string {
  return `eval "$(opencode-studio completion ${shell})"  # ${COMPLETION_MARKER}`
}

/** Rc files we may update for the current user. */
export function candidateRcFiles(home = os.homedir()): ShellRc[] {
  return [
    { shell: "bash", rcPath: path.join(home, ".bashrc"), line: completionLine("bash") },
    { shell: "zsh", rcPath: path.join(home, ".zshrc"), line: completionLine("zsh") },
  ]
}

export function rcAlreadyConfigured(content: string, marker = COMPLETION_MARKER): boolean {
  if (content.includes(marker)) return true
  // Prior manual installs without the marker
  return /opencode-studio completion (bash|zsh)/.test(content)
}

export type EnsureCompletionResult = {
  skipped: boolean
  reason?: string
  updated: string[]
  already: string[]
  missing: string[]
}

/**
 * Append completion eval lines to shell rc files when missing.
 * Never throws for ordinary FS issues — returns a structured result.
 */
export async function ensureShellCompletions(input?: {
  home?: string
  /** When true, only touch rc files that already exist (default true). */
  onlyExisting?: boolean
  /**
   * Limit which shells to touch. Default: prefer $SHELL when set, otherwise both.
   * Pass ["bash","zsh"] to always dual-write.
   */
  shells?: Array<"bash" | "zsh">
}): Promise<EnsureCompletionResult> {
  const home = input?.home ?? os.homedir()
  const onlyExisting = input?.onlyExisting ?? true
  const updated: string[] = []
  const already: string[] = []
  const missing: string[] = []

  if (!home) {
    return { skipped: true, reason: "no HOME", updated, already, missing }
  }

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
      if (rcAlreadyConfigured(content)) {
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

  return { skipped: false, updated, already, missing }
}

export function preferredShells(shellPath?: string): Array<"bash" | "zsh"> {
  const base = path.basename(shellPath ?? "")
  if (base === "zsh") return ["zsh"]
  if (base === "bash") return ["bash"]
  return ["bash", "zsh"]
}

export function shouldRunPostinstallCompletion(env: NodeJS.ProcessEnv = process.env): { ok: boolean; reason?: string } {
  if (env.OPENCODE_STUDIO_SKIP_COMPLETION === "1" || env.OPENCODE_STUDIO_SKIP_COMPLETION === "true") {
    return { ok: false, reason: "OPENCODE_STUDIO_SKIP_COMPLETION" }
  }
  if (env.CI === "true" || env.CI === "1") {
    return { ok: false, reason: "CI" }
  }
  // npm/yarn/pnpm global install
  const globalFlag = env.npm_config_global
  if (globalFlag === "true" || globalFlag === "1") return { ok: true }
  // Some npm versions set config only via npm_config_argv
  if (env.npm_config_argv?.includes('"global":true') || env.npm_config_argv?.includes("--global")) {
    return { ok: true }
  }
  return { ok: false, reason: "not a global install" }
}
