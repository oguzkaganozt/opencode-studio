import { homedir } from "node:os"
import path from "node:path"

/**
 * User-global locations (config global, data local).
 *
 * - Optional studio roots: $XDG_CONFIG_HOME/opencode-studio/studio.json
 * - OpenCode plugin/MCP:   $XDG_CONFIG_HOME/opencode/opencode.json[c]
 * - Managed skills:        $XDG_CONFIG_HOME/opencode/skills/studio-<id>/
 * - Managed agents:        $XDG_CONFIG_HOME/opencode/agents/studio-<id>.md
 *
 * Overrides (absolute paths) for tests / isolation:
 *   OPENCODE_STUDIO_CONFIG_HOME  — studio config home (roots)
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

function resolveXdgConfigApp(options: UserPathOptions, explicit: string | undefined, envKey: string, appName: string) {
  if (explicit) return path.resolve(explicit)
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const override = absoluteEnv(env, envKey)
  if (override) return override
  const xdg = absoluteEnv(env, "XDG_CONFIG_HOME")
  if (xdg) return path.join(xdg, appName)
  return path.join(home, ".config", appName)
}

export function resolveStudioConfigHome(options: UserPathOptions = {}) {
  return resolveXdgConfigApp(options, options.studioConfigHome, "OPENCODE_STUDIO_CONFIG_HOME", "opencode-studio")
}

export function resolveOpenCodeHome(options: UserPathOptions = {}) {
  return resolveXdgConfigApp(options, options.openCodeHome, "OPENCODE_CONFIG_HOME", "opencode")
}

export function resolveOpenCodeSkillsHome(options: UserPathOptions = {}) {
  return path.join(resolveOpenCodeHome(options), "skills")
}

export function resolveOpenCodeAgentsHome(options: UserPathOptions = {}) {
  return path.join(resolveOpenCodeHome(options), "agents")
}

/** Managed OpenCode plugin drop-ins (short file:// paths for UI). */
export function resolveOpenCodePluginsHome(options: UserPathOptions = {}) {
  return path.join(resolveOpenCodeHome(options), "plugins")
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
