import { readFile } from "node:fs/promises"
import path from "node:path"
import { StudioError } from "./core/errors"
import { atomicWriteJson, canonicalExistingDirectory, ensureDirectory, isInside, resolveWorkspace } from "./core/paths"
import { isLegacyStudioId, isStudioId, STUDIO_IDS, type StudioId } from "./core/registry"
import { resolveStudioConfigHome, type UserPathOptions } from "./core/user-paths"
import { getStudioDefinition } from "./studios"

/** On-disk shape: optional absolute roots only. Domains are always on. */
export type StudioConfig = {
  roots?: Partial<Record<StudioId, string>>
}

export type ResolvedStudioConfig = {
  configPath: string
  configHome: string
  /** Always the full catalog — domains are not toggleable. */
  enabled: StudioId[]
  roots: Partial<Record<StudioId, string>>
  error?: string
  warnings?: string[]
}

const EMPTY: StudioConfig = {}

export type StudioConfigOptions = UserPathOptions

/** Effective domain set — always the full catalog. */
export function allStudioIds(): StudioId[] {
  return [...STUDIO_IDS]
}

export function studioConfigHome(options: StudioConfigOptions = {}) {
  return resolveStudioConfigHome(options)
}

export function studioConfigPath(options: StudioConfigOptions = {}) {
  return path.join(resolveStudioConfigHome(options), "studio.json")
}

export type ParseStudioConfigResult = StudioConfig & { warnings: string[] }

function parseRoots(raw: unknown, warnings: string[], strict: boolean): Partial<Record<StudioId, string>> | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StudioError("invalid_config", "studio.json.roots must be an object")
  }
  const roots: Partial<Record<StudioId, string>> = {}
  for (const [key, root] of Object.entries(raw as Record<string, unknown>)) {
    if (!isStudioId(key)) {
      if (isLegacyStudioId(key) || key === "media") {
        warnings.push(`Ignoring legacy roots.${key}`)
      } else if (strict) {
        throw new StudioError("invalid_config", `Unknown Studio ID in roots: ${key}`)
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
  return Object.keys(roots).length > 0 ? roots : undefined
}

/**
 * Parse studio.json. Domains are always on — legacy `enabled` is ignored.
 * Missing/empty file is valid (roots optional).
 */
export function parseStudioConfig(raw: unknown): ParseStudioConfigResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StudioError("invalid_config", "studio.json must be an object")
  }
  const value = raw as Record<string, unknown>
  const warnings: string[] = []

  if (value.enabled !== undefined) {
    warnings.push("Ignoring legacy studio.json.enabled — CAD and PCB are always on")
  }

  const roots = parseRoots(value.roots, warnings, false)
  return roots ? { roots, warnings } : { warnings }
}

/** Strict parse for configure writes — roots only. */
export function parseStudioConfigStrict(raw: unknown): StudioConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StudioError("invalid_config", "studio.json must be an object")
  }
  const value = raw as Record<string, unknown>
  const warnings: string[] = []
  const roots = parseRoots(value.roots, warnings, true)
  return roots ? { roots } : {}
}

export async function readStudioConfigFile(options: StudioConfigOptions = {}): Promise<ResolvedStudioConfig> {
  const configHome = resolveStudioConfigHome(options)
  const configPath = path.join(configHome, "studio.json")
  const enabled = allStudioIds()
  try {
    const text = await readFile(configPath, "utf8")
    const parsed = parseStudioConfig(JSON.parse(text))
    for (const warning of parsed.warnings) {
      console.error(`[opencode-studio] ${warning}`)
    }
    return {
      configHome,
      configPath,
      enabled,
      roots: parsed.roots ?? {},
      warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { configHome, configPath, enabled, roots: {} }
    }
    const message = error instanceof Error ? error.message : String(error)
    // Domains stay on; bad file only drops optional roots.
    return { configHome, configPath, enabled, roots: {}, error: message }
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
    return parsed.roots ? { roots: parsed.roots } : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    return null
  }
}

/**
 * One-shot upgrade: if user-global config is missing and the domain still has
 * a legacy project `studio.json` with roots, copy roots into the global path.
 */
export async function maybeMigrateLegacyConfig(
  domainRoot: string,
  options: StudioConfigOptions = {},
): Promise<{ migrated: boolean; config: ResolvedStudioConfig; legacyPath?: string }> {
  const current = await readStudioConfigFile(options)
  if (current.error || Object.keys(current.roots).length > 0) {
    return { migrated: false, config: current }
  }
  try {
    await readFile(current.configPath, "utf8")
    // Global file exists (even empty) — do not overwrite with legacy.
    return { migrated: false, config: current }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { migrated: false, config: current }
    }
  }

  const legacy = await readLegacyStudioConfig(domainRoot)
  if (!legacy?.roots || Object.keys(legacy.roots).length === 0) {
    return { migrated: false, config: current }
  }

  const written = await writeStudioConfigFile(legacy, options)
  return {
    migrated: true,
    legacyPath: legacyStudioConfigPath(domainRoot),
    config: {
      configHome: written.configHome,
      configPath: written.configPath,
      enabled: allStudioIds(),
      roots: written.config.roots ?? {},
    },
  }
}

export async function writeStudioConfigFile(config: StudioConfig, options: StudioConfigOptions = {}) {
  const validated = parseStudioConfigStrict(config)
  const configHome = resolveStudioConfigHome(options)
  const configPath = path.join(configHome, "studio.json")
  const payload = validated.roots && Object.keys(validated.roots).length > 0 ? { roots: validated.roots } : {}
  await atomicWriteJson(configPath, payload, { mode: 0o644 })
  return { configPath, configHome, config: validated }
}

/**
 * Compute domain root path without touching the filesystem.
 * - override: absolute `roots.<id>`
 * - default: Studio Home + definition `root.relativePath`
 */
export function studioDomainRootPath(input: { studioId: StudioId; studioRoot: string; roots?: Partial<Record<StudioId, string>> }): string {
  const override = input.roots?.[input.studioId]
  if (override) return path.resolve(override)

  const def = getStudioDefinition(input.studioId)
  const home = path.resolve(input.studioRoot)
  const relative = def.root.relativePath?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") ?? ""
  const target = relative ? path.resolve(home, ...relative.split("/").filter(Boolean)) : home
  if (target !== home && !isInside(home, target)) {
    throw new StudioError("invalid_config", `${input.studioId} root.relativePath escapes Studio Home`)
  }
  return target
}

/**
 * Resolve a studio's domain data root on disk.
 * - override in global config.roots.<id> (absolute) — that path is the domain root
 * - default: Studio Home + definition `root.relativePath` (e.g. `studio`, `studio/circuits`)
 */
export async function resolveStudioRoot(input: {
  studioId: StudioId
  studioRoot: string
  roots?: Partial<Record<StudioId, string>>
  create?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<string> {
  const def = getStudioDefinition(input.studioId)
  const shouldCreate = input.create ?? def.root.create
  const target = studioDomainRootPath(input)

  if (shouldCreate && def.root.create) return ensureDirectory(target, 0o700)
  return canonicalExistingDirectory(target, `${input.studioId} root`)
}

/** Domain workspace (data root) + global studio config. */
export async function loadProjectState(explicitWorkspace?: string, options: StudioConfigOptions = {}) {
  const workspace = await resolveWorkspace(explicitWorkspace)
  const config = await readStudioConfigFile(options)
  return { workspace, config }
}

export { EMPTY, STUDIO_IDS }
