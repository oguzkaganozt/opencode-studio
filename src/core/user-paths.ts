import { homedir } from "node:os"
import path from "node:path"

/**
 * User-global locations (config global, data local).
 *
 * - Studio enablement:  $XDG_CONFIG_HOME/opencode-studio/studio.json
 * - OpenCode plugin/MCP: $XDG_CONFIG_HOME/opencode/opencode.json[c]
 * - Managed skills:      $XDG_CONFIG_HOME/opencode/skills/<id>-studio/
 *
 * Overrides (absolute paths) for tests / isolation:
 *   OPENCODE_STUDIO_CONFIG_HOME  — studio enablement home
 *   OPENCODE_CONFIG_HOME         — where *this package* writes OpenCode config/skills
 *                                  (not OpenCode's own OPENCODE_CONFIG_DIR; defaults match ~/.config/opencode)
 */
export type UserPathOptions = {
  env?: NodeJS.ProcessEnv
  home?: string
  studioConfigHome?: string
  openCodeHome?: string
}

function absoluteEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return undefined
  if (!path.isAbsolute(value)) return undefined
  return path.resolve(value)
}

export function resolveStudioConfigHome(options: UserPathOptions = {}) {
  if (options.studioConfigHome) return path.resolve(options.studioConfigHome)
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const override = absoluteEnv(env, "OPENCODE_STUDIO_CONFIG_HOME")
  if (override) return override
  const xdg = absoluteEnv(env, "XDG_CONFIG_HOME")
  if (xdg) return path.join(xdg, "opencode-studio")
  return path.join(home, ".config", "opencode-studio")
}

export function resolveOpenCodeHome(options: UserPathOptions = {}) {
  if (options.openCodeHome) return path.resolve(options.openCodeHome)
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const override = absoluteEnv(env, "OPENCODE_CONFIG_HOME")
  if (override) return override
  const xdg = absoluteEnv(env, "XDG_CONFIG_HOME")
  if (xdg) return path.join(xdg, "opencode")
  return path.join(home, ".config", "opencode")
}

export function resolveOpenCodeSkillsHome(options: UserPathOptions = {}) {
  return path.join(resolveOpenCodeHome(options), "skills")
}

/** Pick only user-path fields from a larger options bag. */
export function pickUserPaths(input: UserPathOptions): UserPathOptions {
  return {
    env: input.env,
    home: input.home,
    studioConfigHome: input.studioConfigHome,
    openCodeHome: input.openCodeHome,
  }
}
