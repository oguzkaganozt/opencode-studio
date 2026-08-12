import { createHash, randomUUID } from "node:crypto"
import { access, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  allStudioIds,
  legacyStudioConfigPath,
  readLegacyStudioConfig,
  readStudioConfigFile,
  resolveStudioRoot,
  studioDomainRootPath,
  writeStudioConfigFile,
} from "./config"
import { ensureUv, resolveEngine } from "./core/engines"
import {
  atomicWriteOpenCodeConfig,
  hasManagedStudioPermissions,
  LEGACY_PACKAGE_NAMES,
  mcpEntries,
  type OpenCodeConfig,
  pluginBaseName,
  pluginEntries,
  readOpenCodeConfig,
  resolveOpenCodeConfigPath,
  withManagedStudioPermissions,
  withMcp,
  withoutManagedStudioPermissions,
  withPlugins,
} from "./core/opencode-config"
import {
  agentNameFor,
  agentSourcePath,
  fileDigest,
  ensureForgeRuntimeDir,
  forgeRuntimeDir,
  LEGACY_MANAGED_MCP_KEY,
  loadPackageMeta,
  MANAGED_MARKER_NAME,
  MANAGED_MEDIA_GO_PLUGIN_NAME,
  type PackageMeta,
  skillDigest,
  skillNameFor,
  skillSourcePath,
} from "./core/package-meta"
import { atomicWriteJson, packageRootFrom, resolveWorkspace } from "./core/paths"
import type { StudioDoctorCheck, StudioId } from "./core/registry"
import { STUDIO_IDS } from "./core/registry"
import { assertNotRoot } from "./core/security"
import {
  pickUserPaths,
  resolveOpenCodeAgentsHome,
  resolveOpenCodePluginsHome,
  resolveOpenCodeSkillsHome,
  type UserPathOptions,
} from "./core/user-paths"
import { probeLocalStudioHost } from "./studio-host-bind"
import { getStudioDefinition } from "./studios"

type ManagedMarker = {
  studioId: string
  packageVersion: string
  digest: string
}

type LifecyclePaths = UserPathOptions & {
  /** Studio Home containing all default domain roots. Defaults to cwd. */
  workspace?: string
  packageRoot?: string
}

type SkillTarget = {
  id: string
  skillName: string
  sourceSkillFile: string
}

type AgentTarget = {
  id: StudioId
  agentName: string
  sourceAgentFile: string
}

async function readMarker(markerFile: string): Promise<ManagedMarker | null> {
  try {
    const raw = JSON.parse(await readFile(markerFile, "utf8")) as Partial<ManagedMarker>
    if (typeof raw.studioId !== "string" || typeof raw.packageVersion !== "string" || typeof raw.digest !== "string") return null
    return { studioId: raw.studioId, packageVersion: raw.packageVersion, digest: raw.digest }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function currentSkillDigest(skillFile: string) {
  try {
    return await skillDigest(skillFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function restoreFile(filePath: string, content: Buffer | null) {
  if (content === null) {
    await rm(filePath, { force: true })
    return
  }
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.restore`
  try {
    await writeFile(temporary, content, { mode: 0o644 })
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true })
  }
}

function skillPathsFor(target: SkillTarget, userPaths: UserPathOptions = {}) {
  const skillDirectory = path.join(resolveOpenCodeSkillsHome(userPaths), target.skillName)
  return {
    skillName: target.skillName,
    skillDirectory,
    skillFile: path.join(skillDirectory, "SKILL.md"),
    markerFile: path.join(skillDirectory, MANAGED_MARKER_NAME),
    sourceSkillFile: target.sourceSkillFile,
    id: target.id,
  }
}

function studioSkillTarget(studioId: StudioId, packageRoot: string): SkillTarget {
  return {
    id: studioId,
    skillName: skillNameFor(studioId),
    sourceSkillFile: skillSourcePath(packageRoot, studioId),
  }
}

function studioAgentTarget(studioId: StudioId, packageRoot: string): AgentTarget {
  return {
    id: studioId,
    agentName: agentNameFor(studioId),
    sourceAgentFile: agentSourcePath(packageRoot, studioId),
  }
}

function agentPathsFor(target: AgentTarget, userPaths: UserPathOptions = {}) {
  const agentsHome = resolveOpenCodeAgentsHome(userPaths)
  const agentFile = path.join(agentsHome, `${target.agentName}.md`)
  return {
    id: target.id,
    agentName: target.agentName,
    agentsHome,
    agentFile,
    markerFile: `${agentFile}${MANAGED_MARKER_NAME}`,
    sourceAgentFile: target.sourceAgentFile,
  }
}

async function currentFileDigest(file: string) {
  try {
    return await fileDigest(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

function assertAgentConflict(
  paths: ReturnType<typeof agentPathsFor>,
  existingDigest: string | null,
  marker: ManagedMarker | null,
  ownerId: StudioId,
) {
  if (existingDigest && !marker) throw new Error(`Conflict: unmarked agent already exists at ${paths.agentFile}`)
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: agent was modified by the user at ${paths.agentFile}`)
  }
  if (marker && marker.studioId !== ownerId) {
    throw new Error(`Conflict: agent owned by studio '${marker.studioId}' at ${paths.agentFile}`)
  }
}

async function preflightAgent(target: AgentTarget, userPaths: UserPathOptions = {}) {
  const paths = agentPathsFor(target, userPaths)
  assertAgentConflict(paths, await currentFileDigest(paths.agentFile), await readMarker(paths.markerFile), target.id)
}

async function writeManagedAgent(input: { target: AgentTarget; packageVersion: string; userPaths?: UserPathOptions }) {
  const paths = agentPathsFor(input.target, input.userPaths)
  const content = await readFile(paths.sourceAgentFile)
  const digest = createHash("sha256").update(content).digest("hex")
  const existingDigest = await currentFileDigest(paths.agentFile)
  const marker = await readMarker(paths.markerFile)
  assertAgentConflict(paths, existingDigest, marker, input.target.id)
  if (existingDigest === digest && marker?.digest === digest && marker.packageVersion === input.packageVersion) {
    return { paths, changed: false as const, previousAgent: null, previousMarker: null }
  }

  const previousAgent = existingDigest ? await readFile(paths.agentFile) : null
  const previousMarker = marker ? await readFile(paths.markerFile) : null
  await mkdir(paths.agentsHome, { recursive: true })
  const temporary = `${paths.agentFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o644 })
    await rename(temporary, paths.agentFile)
    await atomicWriteJson(paths.markerFile, {
      studioId: input.target.id,
      packageVersion: input.packageVersion,
      digest,
    } satisfies ManagedMarker)
    return { paths, changed: true as const, previousAgent, previousMarker }
  } catch (error) {
    await rm(temporary, { force: true })
    await restoreFile(paths.agentFile, previousAgent)
    await restoreFile(paths.markerFile, previousMarker)
    throw error
  }
}

async function removeManagedAgent(target: AgentTarget, userPaths: UserPathOptions = {}) {
  const paths = agentPathsFor(target, userPaths)
  const existingDigest = await currentFileDigest(paths.agentFile)
  if (!existingDigest) {
    await rm(paths.markerFile, { force: true })
    return
  }
  const marker = await readMarker(paths.markerFile)
  assertAgentConflict(paths, existingDigest, marker, target.id)
  await rm(paths.agentFile)
  await rm(paths.markerFile, { force: true })
  await rmdir(paths.agentsHome).catch(() => {})
}

async function directoryHasChildDesignJson(designsDir: string): Promise<boolean> {
  try {
    const entries = await readdir(designsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      if (await Bun.file(path.join(designsDir, entry.name, "design.json")).exists()) return true
    }
  } catch {
    return false
  }
  return false
}

function assertSkillConflict(
  paths: ReturnType<typeof skillPathsFor>,
  existingDigest: string | null,
  marker: ManagedMarker | null,
  ownerId: string,
  opts: { requirePresent?: boolean } = {},
) {
  if (opts.requirePresent && !existingDigest) return
  if (existingDigest && !marker) {
    throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  }
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  }
  if (marker && marker.studioId !== ownerId) {
    throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)
  }
}

async function preflightSkill(target: SkillTarget, userPaths: UserPathOptions = {}) {
  const paths = skillPathsFor(target, userPaths)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)
  assertSkillConflict(paths, existingDigest, marker, target.id)
}

async function writeManagedSkill(input: { target: SkillTarget; packageRoot: string; packageVersion: string; userPaths?: UserPathOptions }) {
  const paths = skillPathsFor(input.target, input.userPaths)
  const skillContent = await readFile(paths.sourceSkillFile)
  const digest = createHash("sha256").update(skillContent).digest("hex")
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)
  assertSkillConflict(paths, existingDigest, marker, input.target.id)

  if (existingDigest === digest && marker?.digest === digest && marker.packageVersion === input.packageVersion) {
    return { paths, changed: false as const, previousSkill: null, previousMarker: null }
  }

  const previousSkill = existingDigest ? await readFile(paths.skillFile) : null
  const previousMarker = marker ? await readFile(paths.markerFile) : null
  await mkdir(paths.skillDirectory, { recursive: true })
  const skillTmp = `${paths.skillFile}.${process.pid}.${randomUUID()}.tmp`
  const nextMarker: ManagedMarker = {
    studioId: input.target.id,
    packageVersion: input.packageVersion,
    digest,
  }
  try {
    await writeFile(skillTmp, skillContent, { mode: 0o644 })
    await rename(skillTmp, paths.skillFile)
    await atomicWriteJson(paths.markerFile, nextMarker)
    return { paths, changed: true as const, previousSkill, previousMarker }
  } catch (error) {
    await rm(skillTmp, { force: true })
    await restoreFile(paths.skillFile, previousSkill)
    await restoreFile(paths.markerFile, previousMarker)
    throw error
  }
}

async function removeManagedSkill(target: SkillTarget, userPaths: UserPathOptions = {}) {
  const paths = skillPathsFor(target, userPaths)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  if (!existingDigest) {
    await rm(paths.markerFile, { force: true })
    await rmdir(paths.skillDirectory).catch(() => {})
    return
  }
  const marker = await readMarker(paths.markerFile)
  assertSkillConflict(paths, existingDigest, marker, target.id)

  const skillBackup = `${paths.skillFile}.${process.pid}.bak`
  const markerBackup = `${paths.markerFile}.${process.pid}.bak`
  await rename(paths.skillFile, skillBackup)
  await rename(paths.markerFile, markerBackup).catch(async () => {
    await rename(skillBackup, paths.skillFile)
    throw new Error(`Failed to stage skill marker removal at ${paths.markerFile}`)
  })
  try {
    await rm(skillBackup, { force: true })
    await rm(markerBackup, { force: true })
    await rmdir(paths.skillDirectory).catch(() => {})
  } catch (error) {
    await rename(skillBackup, paths.skillFile).catch(() => {})
    await rename(markerBackup, paths.markerFile).catch(() => {})
    throw error
  }
}

/** Former OpenCode-managed build123d MCP entry (uv tool run build123d-mcp@…). */
function isLegacyBuild123dMcpEntry(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (entry.type !== "local") return false
  if (!Array.isArray(entry.command)) return false
  return entry.command.map(String).some((part) => part.includes("build123d-mcp"))
}

function scrubLegacyBuild123dMcp(config: OpenCodeConfig): OpenCodeConfig {
  const mcp = mcpEntries(config)
  const existing = mcp[LEGACY_MANAGED_MCP_KEY]
  if (!existing) return config
  if (!isLegacyBuild123dMcpEntry(existing)) return config
  delete mcp[LEGACY_MANAGED_MCP_KEY]
  return withMcp(config, Object.keys(mcp).length > 0 ? mcp : undefined)
}

function isManagedPackagePluginBase(base: string | null, metaName: string): boolean {
  if (!base) return false
  if (LEGACY_PACKAGE_NAMES.some((legacy) => base === legacy || base.startsWith(`${legacy}/`))) return true
  return base === metaName || base.startsWith(`${metaName}/`)
}

function pluginEntrySpecifier(entry: unknown): string | null {
  if (typeof entry === "string") return entry
  if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0]
  return null
}

function isManagedMainPluginEntry(entry: unknown, meta: PackageMeta, packageRoot: string): boolean {
  const specifier = pluginEntrySpecifier(entry)
  if (!specifier) return false
  if (isManagedPackagePluginBase(pluginBaseName(entry), meta.name)) return true
  if (specifier === mainPluginEntry(packageRoot)) return true
  if (!specifier.startsWith("file://")) return false
  try {
    const file = fileURLToPath(specifier)
    const packageDirectory = path.basename(path.dirname(path.dirname(file)))
    const managedDirectories = [meta.name, ...LEGACY_PACKAGE_NAMES].map((name) => name.split("/").at(-1))
    return (
      path.basename(file) === "plugin.js" && path.basename(path.dirname(file)) === "dist" && managedDirectories.includes(packageDirectory)
    )
  } catch {
    return false
  }
}

function stripManagedPlugins(entries: unknown[], meta: PackageMeta, packageRoot: string): unknown[] {
  return entries.filter((entry) => {
    if (isManagedMediaGoPluginEntry(entry)) return false
    return !isManagedMainPluginEntry(entry, meta, packageRoot)
  })
}

function mainPluginEntry(packageRoot: string) {
  return pathToFileURL(path.join(packageRoot, "dist", "plugin.js")).href
}

async function skillDoctorCheck(input: {
  id: string
  paths: ReturnType<typeof skillPathsFor>
  passLabel: string
  driftLabel: string
}): Promise<StudioDoctorCheck> {
  const existingDigest = await currentSkillDigest(input.paths.skillFile)
  const marker = await readMarker(input.paths.markerFile)
  const sourceDigest = await skillDigest(input.paths.sourceSkillFile)
  if (!existingDigest) {
    return { id: input.id, status: "fail", message: `Missing skill ${input.paths.skillFile}`, repair: "Run opencode-studio repair" }
  }
  if (!marker) {
    return { id: input.id, status: "fail", message: `Unmarked skill at ${input.paths.skillDirectory}` }
  }
  if (marker.digest !== existingDigest) {
    return { id: input.id, status: "fail", message: `User-modified skill at ${input.paths.skillFile}` }
  }
  if (marker.digest !== sourceDigest) {
    return { id: input.id, status: "warn", message: input.driftLabel, repair: "Run opencode-studio repair" }
  }
  return { id: input.id, status: "pass", message: input.passLabel }
}

async function agentDoctorCheck(target: AgentTarget, userPaths: UserPathOptions): Promise<StudioDoctorCheck> {
  const paths = agentPathsFor(target, userPaths)
  const existingDigest = await currentFileDigest(paths.agentFile)
  const marker = await readMarker(paths.markerFile)
  const sourceDigest = await fileDigest(paths.sourceAgentFile)
  const id = `agent:${target.id}`
  if (!existingDigest) return { id, status: "fail", message: `Missing agent ${paths.agentFile}`, repair: "Run opencode-studio repair" }
  if (!marker || marker.studioId !== target.id) return { id, status: "fail", message: `Unmanaged agent at ${paths.agentFile}` }
  if (marker.digest !== existingDigest) return { id, status: "fail", message: `User-modified agent at ${paths.agentFile}` }
  if (sourceDigest !== existingDigest) {
    return { id, status: "warn", message: `Agent version drift for ${target.id}`, repair: "Run opencode-studio repair" }
  }
  return { id, status: "pass", message: `${target.agentName} installed` }
}

async function pushEngineCheck(
  checks: StudioDoctorCheck[],
  id: string,
  engine: string,
  options?: {
    missingMessage?: (engine: string) => string
    missingRepair?: string
  },
) {
  try {
    const resolved = engine === "uv" ? await ensureUv() : resolveEngine(engine as "ffmpeg" | "ffprobe" | "tsci" | "uv")
    if (!resolved) {
      checks.push({
        id,
        status: "fail",
        message: options?.missingMessage?.(engine) ?? `${engine} missing (expected bundled with the package)`,
        repair: options?.missingRepair ?? "Reinstall @oguzkaganozt/opencode-studio",
      })
    } else {
      checks.push({
        id,
        status: "pass",
        message: `${engine} available (${resolved.source}: ${resolved.path})`,
      })
    }
  } catch (error) {
    checks.push({
      id,
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
      repair: options?.missingRepair,
    })
  }
}

function isManagedMediaGoPluginEntry(entry: unknown) {
  const s = String(entry)
  if (s.includes("media-go.js") || s.includes("/media-go")) return true
  const base = pluginBaseName(entry)
  return base === MANAGED_MEDIA_GO_PLUGIN_NAME || base?.endsWith("/media-go") === true || base?.endsWith("media-go.js") === true
}

/**
 * Register media-go from the package dist/ so node_modules resolve and packageRootFrom(dist) works.
 * Legacy plugins/media-go.js copies are removed (they broke load when packages were external).
 * Without dist/ (dev/test), write a stub under plugins/ so configure still succeeds; status fails the stub.
 */
async function resolveMediaGoPluginEntry(packageRoot: string, userPaths: UserPathOptions, dryRun: boolean) {
  const distPath = path.join(packageRoot, "dist", "media-go.js")
  const pluginsHome = resolveOpenCodePluginsHome(userPaths)
  const legacyTarget = path.join(pluginsHome, MANAGED_MEDIA_GO_PLUGIN_NAME)
  if (!dryRun) {
    await rm(legacyTarget, { force: true }).catch(() => {})
  }
  if (await Bun.file(distPath).exists()) {
    return pathToFileURL(distPath).href
  }
  if (!dryRun) {
    await mkdir(pluginsHome, { recursive: true, mode: 0o755 })
    await writeFile(legacyTarget, "export default async function mediaGoStub() {\n  return {}\n}\n", "utf8")
  }
  return pathToFileURL(legacyTarget).href
}

function mediaGoEntryFilePath(entry: unknown): string | null {
  const s = String(entry)
  if (s.startsWith("file://")) {
    try {
      return path.normalize(fileURLToPath(s))
    } catch {
      return null
    }
  }
  if (s.endsWith("media-go.js") || s.includes("/media-go")) return path.normalize(s)
  return null
}

async function mediaGoLoadable(entry: unknown): Promise<{ ok: boolean; detail: string }> {
  const filePath = mediaGoEntryFilePath(entry)
  if (!filePath) return { ok: false, detail: "media-go entry is not a file:// path" }
  if (!(await Bun.file(filePath).exists())) return { ok: false, detail: `media-go missing at ${filePath}` }
  try {
    const body = await readFile(filePath, "utf8")
    if (body.includes("mediaGoStub")) {
      return { ok: false, detail: "media-go is a stub (build package dist/ first)" }
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, detail: filePath }
}

async function removeManagedMediaGoPluginFile(userPaths: UserPathOptions) {
  const target = path.join(resolveOpenCodePluginsHome(userPaths), MANAGED_MEDIA_GO_PLUGIN_NAME)
  await rm(target, { force: true }).catch(() => {})
}

async function resolveDomainRootOptional(explicit?: string) {
  try {
    return await resolveWorkspace(explicit)
  } catch {
    return null
  }
}

async function resolveProjectOpenCodeConfigPath(domainRoot: string) {
  const jsonc = path.join(domainRoot, "opencode.jsonc")
  const json = path.join(domainRoot, "opencode.json")
  const hasJsonc = await Bun.file(jsonc).exists()
  const hasJson = await Bun.file(json).exists()
  if (hasJsonc && hasJson) {
    throw new Error(`Both opencode.json and opencode.jsonc exist under ${domainRoot}; keep exactly one`)
  }
  if (hasJsonc) return jsonc
  if (hasJson) return json
  return null
}

/** Strip managed plugin/MCP/skills/legacy studio.json from a project tree (upgrade cleanup). */
async function scrubProjectLocalManagedState(input: {
  domainRoot: string
  packageRoot: string
  meta: PackageMeta
  validateOpenCode?: boolean
}) {
  const cleaned: string[] = []
  const projectTargets = STUDIO_IDS.map((studioId) => ({ skillName: skillNameFor(studioId), studioId }))
  for (const { skillName, studioId } of projectTargets) {
    const skillDirectory = path.join(input.domainRoot, ".opencode", "skills", skillName)
    const skillFile = path.join(skillDirectory, "SKILL.md")
    const markerFile = path.join(skillDirectory, MANAGED_MARKER_NAME)
    const existingDigest = await currentSkillDigest(skillFile)
    if (!existingDigest) {
      await rm(markerFile, { force: true })
      await rmdir(skillDirectory).catch(() => {})
      continue
    }
    const marker = await readMarker(markerFile)
    if (!marker || marker.digest !== existingDigest || marker.studioId !== studioId) continue
    await rm(skillFile, { force: true })
    await rm(markerFile, { force: true })
    await rmdir(skillDirectory).catch(() => {})
    cleaned.push(skillDirectory)
  }

  const projectConfigPath = await resolveProjectOpenCodeConfigPath(input.domainRoot)
  if (projectConfigPath) {
    const openCode = await readOpenCodeConfig(projectConfigPath)
    const plugins = stripManagedPlugins(pluginEntries(openCode), input.meta, input.packageRoot)
    let working = withPlugins(openCode, plugins)
    working = scrubLegacyBuild123dMcp(working)
    // If the file is only $schema, delete it entirely (project no longer needs a pin).
    const remainingKeys = Object.keys(working.value).filter((k) => {
      if (k === "$schema") return false
      const v = working.value[k]
      if (v === undefined) return false
      if (k === "mcp" && v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) return false
      if (k === "plugin" && Array.isArray(v) && v.length === 0) return false
      return true
    })
    if (remainingKeys.length === 0) {
      await rm(projectConfigPath, { force: true })
      cleaned.push(projectConfigPath)
    } else if (working.text !== openCode.text) {
      await atomicWriteOpenCodeConfig(projectConfigPath, working.text, openCode.exists ? openCode.text : "", {
        validate: input.validateOpenCode !== false,
      })
      cleaned.push(projectConfigPath)
    }
  }

  const legacyPath = legacyStudioConfigPath(input.domainRoot)
  if (await Bun.file(legacyPath).exists()) {
    await rm(legacyPath, { force: true })
    cleaned.push(legacyPath)
  }
  // Drop empty skill parent dirs left after scrub.
  await rmdir(path.join(input.domainRoot, ".opencode", "skills")).catch(() => {})
  await rmdir(path.join(input.domainRoot, ".opencode")).catch(() => {})
  return cleaned
}

/**
 * Install OpenCode plugins plus every Studio's managed skill, agent, and isolation permissions.
 * Domains are always on; build123d session tools ship in the CAD plugin.
 */
export async function configureStudios(
  input: {
    roots?: Partial<Record<StudioId, string>>
    dryRun?: boolean
    validateOpenCode?: boolean
  } & LifecyclePaths = {},
) {
  assertNotRoot("configure")

  const userPaths = pickUserPaths(input)
  const enabled = allStudioIds()
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const domainRoot = await resolveWorkspace(input.workspace)
  const previous = await readStudioConfigFile(userPaths)
  // Preserve roots before legacy project state is scrubbed below. Defer the global write
  // until configure has passed its preflight so dry runs and failed installs stay non-mutating.
  const legacy =
    !previous.error && !(await Bun.file(previous.configPath).exists()) && Object.keys(previous.roots).length === 0
      ? await readLegacyStudioConfig(domainRoot)
      : null
  const desiredRoots: Partial<Record<StudioId, string>> = {}
  const rootSource = input.roots ?? legacy?.roots ?? previous.roots
  for (const id of STUDIO_IDS) {
    if (rootSource[id]) desiredRoots[id] = rootSource[id]!
  }

  if (!input.dryRun) {
    for (const studioId of enabled) {
      const def = getStudioDefinition(studioId)
      await resolveStudioRoot({ studioId, studioRoot: domainRoot, roots: desiredRoots, create: def.root.create })
    }
  }

  for (const studioId of STUDIO_IDS) {
    await preflightSkill(studioSkillTarget(studioId, packageRoot), userPaths)
    await preflightAgent(studioAgentTarget(studioId, packageRoot), userPaths)
  }

  const configPath = await resolveOpenCodeConfigPath(userPaths)
  const openCode = await readOpenCodeConfig(configPath)
  let plugins = [...pluginEntries(openCode)]

  // OpenCode 1.18: npm subpath is not a server entry — file:// into package dist/media-go.js.
  const mediaGoFile = await resolveMediaGoPluginEntry(packageRoot, userPaths, Boolean(input.dryRun))
  plugins = stripManagedPlugins(plugins, meta, packageRoot)
  const pluginFile = mainPluginEntry(packageRoot)
  plugins.push(pluginFile)
  plugins.push(mediaGoFile)

  let working = withPlugins(openCode, plugins)
  // Drop legacy OpenCode-managed build123d MCP; tools are plugin-native via CAD engine.
  working = scrubLegacyBuild123dMcp(working)
  working = withManagedStudioPermissions(working)
  const nextText = working.text
  const uv = input.dryRun ? resolveEngine("uv") : await ensureUv()

  if (input.dryRun) {
    return {
      action: "configure" as const,
      dryRun: true,
      workspace: domainRoot,
      enabled,
      plugin: pluginFile,
      uv: uv?.path ?? null,
      restartRequired: true,
    }
  }

  // Seed CAD engine sources into XDG cache so status/repair do not report unseeded on greenfield.
  await ensureForgeRuntimeDir(packageRoot)

  const installed: string[] = []
  const rollbacks: Array<() => Promise<void>> = []

  try {
    for (const studioId of enabled) {
      const result = await writeManagedSkill({
        target: studioSkillTarget(studioId, packageRoot),
        packageRoot,
        packageVersion: meta.version,
        userPaths,
      })
      installed.push(studioId)
      if (result.changed) {
        rollbacks.push(async () => {
          await restoreFile(result.paths.skillFile, result.previousSkill)
          await restoreFile(result.paths.markerFile, result.previousMarker)
        })
      }

      const agent = await writeManagedAgent({
        target: studioAgentTarget(studioId, packageRoot),
        packageVersion: meta.version,
        userPaths,
      })
      if (agent.changed) {
        rollbacks.push(async () => {
          await restoreFile(agent.paths.agentFile, agent.previousAgent)
          await restoreFile(agent.paths.markerFile, agent.previousMarker)
        })
      }
    }

    if (nextText !== openCode.text) {
      await atomicWriteOpenCodeConfig(configPath, nextText, openCode.exists ? openCode.text : "", {
        validate: input.validateOpenCode !== false,
      })
      rollbacks.push(async () => {
        await restoreFile(configPath, openCode.exists ? Buffer.from(openCode.text) : null)
      })
    }

    const written = await writeStudioConfigFile(
      {
        roots: Object.keys(desiredRoots).length > 0 ? desiredRoots : undefined,
      },
      userPaths,
    )

    let projectScrubbed: string[] = []
    try {
      projectScrubbed = await scrubProjectLocalManagedState({
        domainRoot,
        packageRoot,
        meta,
        validateOpenCode: input.validateOpenCode,
      })
    } catch {
      // Non-fatal: global config already applied; status will surface leftovers.
    }

    let wrapperRemoved: string | undefined
    const pathEnv = input.env ?? process.env
    const isolatedHomes = Boolean(
      input.studioConfigHome || input.openCodeHome || pathEnv.OPENCODE_STUDIO_CONFIG_HOME || pathEnv.OPENCODE_CONFIG_HOME,
    )
    // PATH wrapper is obsolete (`opencode-studio up` supervises). Strip legacy install on repair.
    if (!isolatedHomes) {
      try {
        const { removeOpencodeServeWrapper } = await import("./opencode-wrapper")
        const stripped = await removeOpencodeServeWrapper()
        if (stripped.removed) wrapperRemoved = stripped.path
      } catch {
        // optional cleanup
      }
    }

    return {
      action: "configure" as const,
      dryRun: false,
      workspace: domainRoot,
      enabled,
      installed,
      removed: [] as string[],
      plugin: pluginFile,
      configPath: written.configPath,
      openCodeConfigPath: configPath,
      skillsHome: resolveOpenCodeSkillsHome(userPaths),
      agentsHome: resolveOpenCodeAgentsHome(userPaths),
      projectScrubbed,
      wrapperRemoved,
      restartRequired: true,
      restartOpenCode: true,
      restartHost: false,
      message: wrapperRemoved
        ? `Installed plugins, Studio skills, agents, and permissions. Removed legacy PATH wrapper at ${wrapperRemoved}. Prefer: opencode-studio up. Restart OpenCode.`
        : "Installed plugins, Studio skills, agents, and isolation permissions. Prefer: opencode-studio up. Restart OpenCode to load them.",
    }
  } catch (error) {
    for (const rollback of rollbacks.reverse()) {
      await rollback().catch(() => {})
    }
    throw error
  }
}

/**
 * Uninstall managed OpenCode state (Studio skills, agents, permissions, and package plugins).
 * Also scrubs legacy build123d MCP entries. Studios remain always-on in code once re-registered.
 */
export async function removeStudios(input: LifecyclePaths & { validateOpenCode?: boolean } = {}) {
  assertNotRoot("remove")

  const userPaths = pickUserPaths(input)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const domainRoot = await resolveDomainRootOptional(input.workspace)
  const previous = await readStudioConfigFile(userPaths)
  const desiredRoots = previous.roots

  const skillTargets = STUDIO_IDS.map((id) => studioSkillTarget(id, packageRoot))
  const agentTargets = STUDIO_IDS.map((id) => studioAgentTarget(id, packageRoot))

  for (const target of skillTargets) {
    const paths = skillPathsFor(target, userPaths)
    const existingDigest = await currentSkillDigest(paths.skillFile)
    const marker = await readMarker(paths.markerFile)
    assertSkillConflict(paths, existingDigest, marker, target.id)
  }
  for (const target of agentTargets) await preflightAgent(target, userPaths)

  const configPath = await resolveOpenCodeConfigPath(userPaths)
  const openCode = await readOpenCodeConfig(configPath)
  const plugins = stripManagedPlugins([...pluginEntries(openCode)], meta, packageRoot)

  let working = withPlugins(openCode, plugins)
  working = scrubLegacyBuild123dMcp(working)
  working = withoutManagedStudioPermissions(working)
  const nextText = working.text

  await removeManagedMediaGoPluginFile(userPaths)

  const removed: string[] = []
  for (const target of skillTargets) {
    const paths = skillPathsFor(target, userPaths)
    if (!(await Bun.file(paths.skillFile).exists()) && !(await Bun.file(paths.markerFile).exists())) continue
    await removeManagedSkill(target, userPaths)
    removed.push(target.id)
  }
  for (const target of agentTargets) {
    const paths = agentPathsFor(target, userPaths)
    if (!(await Bun.file(paths.agentFile).exists()) && !(await Bun.file(paths.markerFile).exists())) continue
    await removeManagedAgent(target, userPaths)
  }

  if (nextText !== openCode.text) {
    await atomicWriteOpenCodeConfig(configPath, nextText, openCode.exists ? openCode.text : "", {
      validate: input.validateOpenCode !== false,
    })
  }

  const written = await writeStudioConfigFile({ roots: Object.keys(desiredRoots).length > 0 ? desiredRoots : undefined }, userPaths)

  if (domainRoot) {
    try {
      await scrubProjectLocalManagedState({
        domainRoot,
        packageRoot,
        meta,
        validateOpenCode: input.validateOpenCode,
      })
    } catch {
      // non-fatal
    }
  }

  let wrapperRemoved: string | undefined
  try {
    const { removeOpencodeServeWrapper } = await import("./opencode-wrapper")
    const stripped = await removeOpencodeServeWrapper()
    if (stripped.removed) wrapperRemoved = stripped.path
  } catch {
    // optional
  }

  return {
    action: "remove" as const,
    dryRun: false,
    workspace: domainRoot ?? undefined,
    enabled: allStudioIds(),
    installed: [] as string[],
    removed,
    plugin: meta.pluginSpecifier,
    configPath: written.configPath,
    openCodeConfigPath: configPath,
    skillsHome: resolveOpenCodeSkillsHome(userPaths),
    agentsHome: resolveOpenCodeAgentsHome(userPaths),
    wrapperRemoved,
    restartRequired: true,
    restartOpenCode: true,
    restartHost: false,
    message: wrapperRemoved
      ? `Removed managed plugins, skills, agents, permissions, and legacy PATH wrapper (${wrapperRemoved}). Restart OpenCode. Run repair to reinstall.`
      : "Removed managed plugins, skills, agents, and permissions. Restart OpenCode. Run repair to reinstall.",
  }
}

export async function statusStudios(input: LifecyclePaths = {}) {
  const userPaths = pickUserPaths(input)
  const domainRoot = await resolveWorkspace(input.workspace)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const config = await readStudioConfigFile(userPaths)
  const studios = []
  for (const studioId of STUDIO_IDS) {
    const def = getStudioDefinition(studioId)
    let root: string | null = null
    let rootError: string | undefined
    try {
      root = await resolveStudioRoot({
        studioId,
        studioRoot: domainRoot,
        roots: config.roots,
        create: false,
      })
    } catch (error) {
      rootError = error instanceof Error ? error.message : String(error)
      try {
        root = studioDomainRootPath({
          studioId,
          studioRoot: domainRoot,
          roots: config.roots,
        })
      } catch {
        root = null
      }
    }
    const paths = skillPathsFor(studioSkillTarget(studioId, packageRoot), userPaths)
    const skillInstalled = await Bun.file(paths.skillFile).exists()
    const agentPaths = agentPathsFor(studioAgentTarget(studioId, packageRoot), userPaths)
    const agentInstalled = await Bun.file(agentPaths.agentFile).exists()
    studios.push({
      id: studioId,
      label: def.label,
      description: def.description,
      enabled: true,
      root,
      rootError,
      requiredEngines: def.requiredEngines,
      skill: skillNameFor(studioId),
      skillInstalled,
      agent: agentNameFor(studioId),
      agentInstalled,
    })
  }

  const checks: StudioDoctorCheck[] = []
  checks.push({
    id: "package",
    status: "pass",
    message: `${meta.name}@${meta.version}`,
  })

  if (config.error) {
    checks.push({
      id: "config",
      status: "warn",
      message: `studio.json error (domains still on; roots ignored): ${config.error}`,
      repair: `Fix or remove ${config.configPath}`,
    })
  } else {
    checks.push({
      id: "config",
      status: "pass",
      message: `Domains always on: ${config.enabled.join(", ")} (${config.configPath})`,
    })
  }

  const legacyPath = legacyStudioConfigPath(domainRoot)
  const legacy = await readLegacyStudioConfig(domainRoot)
  if (legacy) {
    checks.push({
      id: "legacy-project-config",
      status: "warn",
      message: `Legacy project config still present: ${legacyPath}`,
      repair: "Run opencode-studio repair (scrubs project files) or delete the legacy path",
    })
  }

  // Pre-studio/ layout: designs lived at $HOME/designs (CAD root was Studio Home).
  if (!config.roots.cad) {
    const oldDesigns = path.join(domainRoot, "designs")
    const newDesigns = path.join(domainRoot, "studio", "designs")
    const oldHasDesign = await directoryHasChildDesignJson(oldDesigns)
    if (oldHasDesign) {
      const newHasDesign = await directoryHasChildDesignJson(newDesigns)
      if (!newHasDesign) {
        checks.push({
          id: "legacy-home-designs",
          status: "warn",
          message: `CAD designs still under ${oldDesigns}; default root is now ${newDesigns}`,
          repair: `Move projects into ${newDesigns}/, or set roots.cad to that designs directory`,
        })
      }
    }
  } else {
    // Intermediate contract: roots.cad was parent of designs/ (children = designs/<id>).
    // Current contract: roots.cad is the designs directory (children = <id>).
    const cadRoot = path.resolve(config.roots.cad)
    const nestedDesigns = path.join(cadRoot, "designs")
    if ((await directoryHasChildDesignJson(nestedDesigns)) && !(await directoryHasChildDesignJson(cadRoot))) {
      checks.push({
        id: "legacy-cad-root-nested-designs",
        status: "warn",
        message: `roots.cad is ${cadRoot} but projects live under ${nestedDesigns}/ (old parent-of-designs layout)`,
        repair: `Set roots.cad to ${nestedDesigns}, or move each project up into ${cadRoot}/<id>/`,
      })
    }
  }

  for (const studioId of STUDIO_IDS) {
    const skillDir = path.join(domainRoot, ".opencode", "skills", skillNameFor(studioId))
    if (await Bun.file(path.join(skillDir, "SKILL.md")).exists()) {
      checks.push({
        id: `legacy-project-skill:${studioId}`,
        status: "warn",
        message: `Project-local skill leftover: ${skillDir}`,
        repair: "Run opencode-studio repair to scrub, or delete the directory",
      })
    }
  }
  try {
    const projectOpenCode = await resolveProjectOpenCodeConfigPath(domainRoot)
    if (projectOpenCode) {
      const openCode = await readOpenCodeConfig(projectOpenCode)
      const hasPlugin = pluginEntries(openCode).some((entry) => isManagedMainPluginEntry(entry, meta, packageRoot))
      const hasLegacyMcp = isLegacyBuild123dMcpEntry(mcpEntries(openCode)[LEGACY_MANAGED_MCP_KEY])
      if (hasPlugin || hasLegacyMcp) {
        checks.push({
          id: "legacy-project-opencode",
          status: "warn",
          message: `Project OpenCode config still pins studio plugin/legacy MCP: ${projectOpenCode}`,
          repair: "Run opencode-studio repair to scrub managed entries, or edit the file",
        })
      }
    }
  } catch (error) {
    checks.push({
      id: "legacy-project-opencode",
      status: "warn",
      message: error instanceof Error ? error.message : String(error),
    })
  }

  const openCodePath = await resolveOpenCodeConfigPath(userPaths)
  try {
    const openCode = await readOpenCodeConfig(openCodePath)
    const entries = pluginEntries(openCode)
    const expectedPlugin = mainPluginEntry(packageRoot)
    const registered = entries.some((entry) => String(entry) === expectedPlugin)
    const mediaGoEntry = entries.find((entry) => isManagedMediaGoPluginEntry(entry))
    checks.push({
      id: "plugin-registration",
      status: registered ? "pass" : "fail",
      message: registered ? `Plugin loadable (${expectedPlugin})` : `Plugin not registered as ${expectedPlugin}`,
      repair: registered ? undefined : "Run opencode-studio repair",
    })
    if (!mediaGoEntry) {
      checks.push({
        id: "plugin-media-go",
        status: "fail",
        message: "media-go not registered",
        repair: "Run opencode-studio repair",
      })
    } else {
      const loadable = await mediaGoLoadable(mediaGoEntry)
      checks.push({
        id: "plugin-media-go",
        status: loadable.ok ? "pass" : "fail",
        message: loadable.ok ? `media-go loadable (${loadable.detail})` : loadable.detail,
        repair: loadable.ok ? undefined : "Run bun run build && opencode-studio repair (needs dist/media-go.js)",
      })
    }
    const legacyMcp = mcpEntries(openCode)[LEGACY_MANAGED_MCP_KEY]
    if (isLegacyBuild123dMcpEntry(legacyMcp)) {
      checks.push({
        id: "legacy-mcp-build123d",
        status: "warn",
        message: `Legacy OpenCode mcp.build123d entry still present in ${openCodePath}`,
        repair: "Run opencode-studio repair to scrub (build123d tools are plugin-native now)",
      })
    }
    const permissionsInstalled = hasManagedStudioPermissions(openCode)
    checks.push({
      id: "permission:studio",
      status: permissionsInstalled ? "pass" : "fail",
      message: permissionsInstalled ? "Studio isolation permissions installed" : "Studio isolation permissions are missing or incomplete",
      repair: permissionsInstalled ? undefined : "Run opencode-studio repair",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    checks.push({
      id: "plugin-registration",
      status: "fail",
      message,
    })
    checks.push({
      id: "plugin-media-go",
      status: "fail",
      message: `Could not verify media-go: ${message}`,
      repair: "Run opencode-studio repair",
    })
    checks.push({ id: "permission:studio", status: "fail", message: `Could not verify Studio permissions: ${message}` })
  }

  for (const studio of studios) {
    const studioId = studio.id as StudioId
    const def = getStudioDefinition(studioId)
    const target = studioSkillTarget(studioId, packageRoot)
    checks.push(
      await skillDoctorCheck({
        id: `skill:${studioId}`,
        paths: skillPathsFor(target, userPaths),
        passLabel: `${def.skill} installed`,
        driftLabel: `Skill version drift for ${studioId}`,
      }),
    )
    checks.push(await agentDoctorCheck(studioAgentTarget(studioId, packageRoot), userPaths))

    if (studio.root && !studio.rootError) {
      checks.push({ id: `root:${studioId}`, status: "pass", message: studio.root })
    } else {
      checks.push({
        id: `root:${studioId}`,
        status: "fail",
        message: studio.rootError ?? "root unavailable",
      })
    }

    for (const engine of def.requiredEngines) {
      await pushEngineCheck(checks, `engine:${studioId}:${engine}`, engine, {
        missingRepair: "Reinstall @oguzkaganozt/opencode-studio or install the engine on PATH",
      })
    }

    if (studioId === "pcb") {
      const npmPath = Bun.which("npm")
      checks.push({
        id: "engine:pcb:npm",
        status: npmPath ? "pass" : "warn",
        message: npmPath
          ? `npm available (${npmPath})`
          : "npm missing on PATH — PCB build falls back to bundled tsci (install Node/npm for full project scripts)",
        repair: npmPath ? undefined : "Install Node.js (includes npm) for preferred PCB authoring",
      })
    }

    if (studioId === "cad") {
      const forgeDir = forgeRuntimeDir()
      const pyproject = path.join(forgeDir, "pyproject.toml")
      const venvDir = path.join(forgeDir, ".venv")
      let hasProject = false
      let hasVenv = false
      try {
        await access(pyproject)
        hasProject = true
      } catch {
        hasProject = false
      }
      try {
        hasVenv = (await stat(venvDir)).isDirectory()
      } catch {
        hasVenv = false
      }
      if (!hasProject) {
        checks.push({
          id: "cad-engine",
          status: "warn",
          message: `CAD engine runtime not seeded at ${forgeDir}`,
          repair: "Run opencode-studio repair (seeds engine) or cad_design_build once",
        })
      } else if (!hasVenv) {
        checks.push({
          id: "cad-engine",
          status: "warn",
          message: `CAD engine sources present but venv not synced (${forgeDir})`,
          repair: "Run cad_design_build once (syncs engine deps automatically)",
        })
      } else {
        checks.push({
          id: "cad-engine",
          status: "pass",
          message: `CAD engine venv ready (${forgeDir})`,
        })
      }
    }
  }

  const host = await probeLocalStudioHost()
  checks.push({
    id: "studio-host",
    status: host.ok ? "pass" : "warn",
    message: host.ok ? `Studio host up at ${host.url}` : `Studio host not reachable at ${host.url} (run opencode-studio up)`,
  })

  const failed = checks.some((check) => check.status === "fail")
  return {
    packageName: meta.name,
    packageVersion: meta.version,
    workspace: domainRoot,
    configPath: config.configPath,
    configHome: config.configHome,
    configError: config.error,
    enabled: allStudioIds(),
    plugin: meta.pluginSpecifier,
    studios,
    checks,
    ok: !failed,
    restartRequiredHint: "After repair, restart OpenCode so plugins, skills, agents, and permissions load.",
  }
}

export function getPackageRoot() {
  return packageRootFrom(import.meta.dir)
}
