import { readFile } from "node:fs/promises"
import path from "node:path"
import { StudioError } from "./core/errors"
import { atomicWriteJson, canonicalExistingDirectory, ensureDirectory, resolveWorkspace } from "./core/paths"
import { isLegacyStudioId, isStudioId, STUDIO_IDS, type StudioId } from "./core/registry"
import { resolveStudioConfigHome, type UserPathOptions } from "./core/user-paths"
import { getStudioDefinition } from "./studios"

export type StudioConfig = {
  enabled: StudioId[]
  roots?: Partial<Record<StudioId, string>>
}

export type ResolvedStudioConfig = {
  configPath: string
  configHome: string
  enabled: StudioId[]
  roots: Partial<Record<StudioId, string>>
  error?: string
  warnings?: string[]
}

const EMPTY: StudioConfig = { enabled: [] }

export type StudioConfigOptions = UserPathOptions

export function studioConfigHome(options: StudioConfigOptions = {}) {
  return resolveStudioConfigHome(options)
}

export function studioConfigPath(options: StudioConfigOptions = {}) {
  return path.join(resolveStudioConfigHome(options), "studio.json")
}

export type ParseStudioConfigResult = StudioConfig & { warnings: string[] }

/**
 * Parse studio.json. Unknown / legacy studio ids in enabled or roots are stripped with warnings
 * (not a hard fail), so platform media still loads on upgrade.
 */
export function parseStudioConfig(raw: unknown): ParseStudioConfigResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StudioError("invalid_config", "studio.json must be an object")
  }
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.enabled) || !value.enabled.every((item) => typeof item === "string")) {
    throw new StudioError("invalid_config", "studio.json.enabled must be an array of Studio IDs")
  }
  const warnings: string[] = []
  const seen = new Set<string>()
  const enabled: StudioId[] = []
  for (const id of value.enabled as string[]) {
    if (isStudioId(id)) {
      if (seen.has(id)) continue
      seen.add(id)
      enabled.push(id)
      continue
    }
    if (isLegacyStudioId(id)) {
      warnings.push(`Ignoring legacy studio id in enabled: ${id}`)
      continue
    }
    warnings.push(`Ignoring unknown studio id in enabled: ${id}`)
  }

  let roots: Partial<Record<StudioId, string>> | undefined
  if (value.roots !== undefined) {
    if (!value.roots || typeof value.roots !== "object" || Array.isArray(value.roots)) {
      throw new StudioError("invalid_config", "studio.json.roots must be an object")
    }
    roots = {}
    for (const [key, root] of Object.entries(value.roots as Record<string, unknown>)) {
      if (!isStudioId(key)) {
        if (isLegacyStudioId(key) || key === "media") {
          warnings.push(`Ignoring legacy roots.${key}`)
        } else {
          warnings.push(`Ignoring unknown roots.${key}`)
        }
        continue
      }
      if (typeof root !== "string" || root.length === 0 || root.includes("\0") || !path.isAbsolute(root)) {
        throw new StudioError("invalid_config", `roots.${key} must be an absolute path`)
      }
      roots[key] = path.resolve(root)
    }
    if (Object.keys(roots).length === 0) roots = undefined
  }
  return roots ? { enabled, roots, warnings } : { enabled, warnings }
}

/** Strict parse for configure CLI positionals — unknown ids are errors. */
export function parseStudioConfigStrict(raw: unknown): StudioConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StudioError("invalid_config", "studio.json must be an object")
  }
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.enabled) || !value.enabled.every((item) => typeof item === "string")) {
    throw new StudioError("invalid_config", "studio.json.enabled must be an array of Studio IDs")
  }
  const enabled: StudioId[] = []
  const seen = new Set<string>()
  for (const id of value.enabled as string[]) {
    if (!isStudioId(id)) throw new StudioError("invalid_config", `Unknown Studio ID: ${id}`)
    if (seen.has(id)) continue
    seen.add(id)
    enabled.push(id)
  }
  let roots: Partial<Record<StudioId, string>> | undefined
  if (value.roots !== undefined) {
    if (!value.roots || typeof value.roots !== "object" || Array.isArray(value.roots)) {
      throw new StudioError("invalid_config", "studio.json.roots must be an object")
    }
    roots = {}
    for (const [key, root] of Object.entries(value.roots as Record<string, unknown>)) {
      if (!isStudioId(key)) throw new StudioError("invalid_config", `Unknown Studio ID in roots: ${key}`)
      if (typeof root !== "string" || root.length === 0 || root.includes("\0") || !path.isAbsolute(root)) {
        throw new StudioError("invalid_config", `roots.${key} must be an absolute path`)
      }
      roots[key] = path.resolve(root)
    }
  }
  return roots ? { enabled, roots } : { enabled }
}

export async function readStudioConfigFile(options: StudioConfigOptions = {}): Promise<ResolvedStudioConfig> {
  const configHome = resolveStudioConfigHome(options)
  const configPath = path.join(configHome, "studio.json")
  try {
    const text = await readFile(configPath, "utf8")
    const parsed = parseStudioConfig(JSON.parse(text))
    for (const warning of parsed.warnings) {
      console.error(`[opencode-studio] ${warning}`)
    }
    return {
      configHome,
      configPath,
      enabled: parsed.enabled,
      roots: parsed.roots ?? {},
      warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { configHome, configPath, enabled: [], roots: {} }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { configHome, configPath, enabled: [], roots: {}, error: message }
  }
}

/** Pre-global-config location: `<domain>/.opencode/studio.json`. */
export function legacyStudioConfigPath(domainRoot: string) {
  return path.join(path.resolve(domainRoot), ".opencode", "studio.json")
}

export async function readLegacyStudioConfig(domainRoot: string): Promise<StudioConfig | null> {
  const configPath = legacyStudioConfigPath(domainRoot)
  try {
    const text = await readFile(configPath, "utf8")
    const parsed = parseStudioConfig(JSON.parse(text))
    return { enabled: parsed.enabled, roots: parsed.roots }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    return null
  }
}

/**
 * One-shot upgrade: if user-global config is missing/empty and the domain still has
 * a legacy project `studio.json`, copy enablement (+ roots) into the global path.
 */
export async function maybeMigrateLegacyConfig(
  domainRoot: string,
  options: StudioConfigOptions = {},
): Promise<{ migrated: boolean; config: ResolvedStudioConfig; legacyPath?: string }> {
  const current = await readStudioConfigFile(options)
  if (current.error || current.enabled.length > 0) {
    return { migrated: false, config: current }
  }
  try {
    await readFile(current.configPath, "utf8")
    return { migrated: false, config: current }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { migrated: false, config: current }
    }
  }

  const legacy = await readLegacyStudioConfig(domainRoot)
  if (!legacy || legacy.enabled.length === 0) {
    return { migrated: false, config: current }
  }

  const written = await writeStudioConfigFile(legacy, options)
  return {
    migrated: true,
    legacyPath: legacyStudioConfigPath(domainRoot),
    config: {
      configHome: written.configHome,
      configPath: written.configPath,
      enabled: written.config.enabled,
      roots: written.config.roots ?? {},
    },
  }
}

export async function writeStudioConfigFile(config: StudioConfig, options: StudioConfigOptions = {}) {
  const validated = parseStudioConfigStrict(config)
  const configHome = resolveStudioConfigHome(options)
  const configPath = path.join(configHome, "studio.json")
  const payload = {
    enabled: validated.enabled,
    ...(validated.roots && Object.keys(validated.roots).length > 0 ? { roots: validated.roots } : {}),
  }
  await atomicWriteJson(configPath, payload, { mode: 0o644 })
  return { configPath, configHome, config: validated }
}

/**
 * Resolve a studio's domain data root.
 * - override in global config.roots.<id> (absolute)
 * - default: domain workspace (OpenCode project / serve --workspace)
 */
export async function resolveStudioRoot(input: {
  studioId: StudioId
  workspace: string
  roots?: Partial<Record<StudioId, string>>
  create?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<string> {
  const def = getStudioDefinition(input.studioId)
  const shouldCreate = input.create ?? def.root.create
  const override = input.roots?.[input.studioId]

  if (override) {
    if (shouldCreate && def.root.create) return ensureDirectory(override, 0o700)
    return canonicalExistingDirectory(override, `${input.studioId} root`)
  }

  return input.workspace
}

/** Domain workspace (data root) + global studio config. */
export async function loadProjectState(explicitWorkspace?: string, options: StudioConfigOptions = {}) {
  const workspace = await resolveWorkspace(explicitWorkspace)
  const config = await readStudioConfigFile(options)
  return { workspace, config }
}

export { EMPTY, STUDIO_IDS }
