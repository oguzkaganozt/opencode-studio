import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { StudioError } from "./core/errors"
import { atomicWriteJson, canonicalExistingDirectory, ensureDirectory, resolveWorkspace } from "./core/paths"
import { assertStudioIds, isStudioId, STUDIO_IDS, type StudioId } from "./core/registry"
import { getStudioDefinition } from "./studios"

export type StudioConfig = {
  enabled: StudioId[]
  roots?: Partial<Record<StudioId, string>>
}

export type ResolvedStudioConfig = {
  workspace: string
  configPath: string
  enabled: StudioId[]
  roots: Partial<Record<StudioId, string>>
  error?: string
}

const EMPTY: StudioConfig = { enabled: [] }

export function studioConfigPath(workspace: string) {
  return path.join(workspace, ".opencode", "studio.json")
}

export function defaultMediaRoot(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const xdg = env.XDG_DATA_HOME
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "opencode-studio", "media")
  return path.join(home, ".local", "share", "opencode-studio", "media")
}

export function parseStudioConfig(raw: unknown): StudioConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new StudioError("invalid_config", "studio.json must be an object")
  }
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.enabled) || !value.enabled.every((item) => typeof item === "string")) {
    throw new StudioError("invalid_config", "studio.json.enabled must be an array of Studio IDs")
  }
  const enabled = assertStudioIds(value.enabled as string[])
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

export async function readStudioConfigFile(workspace: string): Promise<ResolvedStudioConfig> {
  const configPath = studioConfigPath(workspace)
  try {
    const text = await readFile(configPath, "utf8")
    const parsed = parseStudioConfig(JSON.parse(text))
    return {
      workspace,
      configPath,
      enabled: parsed.enabled,
      roots: parsed.roots ?? {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { workspace, configPath, enabled: [], roots: {} }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { workspace, configPath, enabled: [], roots: {}, error: message }
  }
}

export async function writeStudioConfigFile(workspace: string, config: StudioConfig) {
  const validated = parseStudioConfig(config)
  const configPath = studioConfigPath(workspace)
  const payload = {
    enabled: validated.enabled,
    ...(validated.roots && Object.keys(validated.roots).length > 0 ? { roots: validated.roots } : {}),
  }
  await atomicWriteJson(configPath, payload, { mode: 0o644 })
  return { configPath, config: validated }
}

export async function resolveStudioRoot(input: {
  studioId: StudioId
  workspace: string
  roots?: Partial<Record<StudioId, string>>
  /** @deprecated use create from StudioDefinition.root; kept for call-site clarity */
  create?: boolean
  createMedia?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<string> {
  const def = getStudioDefinition(input.studioId)
  const shouldCreate = input.create ?? input.createMedia ?? def.root.create
  const override = input.roots?.[input.studioId]

  if (override) {
    if (shouldCreate && def.root.create) return ensureDirectory(override, 0o700)
    return canonicalExistingDirectory(override, `${input.studioId} root`)
  }

  if (def.root.default === "user-data") {
    const root = defaultMediaRoot(input.env)
    if (shouldCreate) return ensureDirectory(root, 0o700)
    return canonicalExistingDirectory(root, `${input.studioId} root`)
  }

  return input.workspace
}

export async function loadProjectState(explicitWorkspace?: string) {
  const workspace = await resolveWorkspace(explicitWorkspace)
  const config = await readStudioConfigFile(workspace)
  return { workspace, config }
}

export { EMPTY, STUDIO_IDS }
