import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  allStudioIds,
  legacyStudioConfigPath,
  readLegacyStudioConfig,
  readStudioConfigFile,
  resolveStudioRoot,
  writeStudioConfigFile,
} from "./config"
import { ensureUv, resolveEngine } from "./core/engines"
import {
  atomicWriteOpenCodeConfig,
  configWithMcp,
  configWithPlugins,
  LEGACY_PACKAGE_NAMES,
  mcpEntries,
  pluginBaseName,
  pluginEntries,
  pluginEntryMatches,
  readOpenCodeConfig,
  resolveOpenCodeConfigPath,
} from "./core/opencode-config"
import {
  BUILD123D_MCP,
  loadPackageMeta,
  MANAGED_MARKER_NAME,
  MANAGED_MCP_KEY,
  type PackageMeta,
  PLATFORM_MEDIA_SKILL_ID,
  platformMediaSkillName,
  platformMediaSkillSourcePath,
  skillDigest,
  skillNameFor,
  skillSourcePath,
} from "./core/package-meta"
import { packageRootFrom, resolveWorkspace } from "./core/paths"
import type { StudioDoctorCheck, StudioId } from "./core/registry"
import { CATALOG_ORDER, STUDIO_IDS } from "./core/registry"
import { assertNotRoot } from "./core/security"
import { pickUserPaths, resolveOpenCodeSkillsHome, type UserPathOptions } from "./core/user-paths"
import { probeLocalStudioHost } from "./studio-host-bind"
import { getStudioDefinition } from "./studios"

export type ManagedMarker = {
  studioId: string
  packageVersion: string
  digest: string
}

export type LifecyclePaths = UserPathOptions & {
  /** Domain data root (CAD/PCB). Defaults to cwd. Not used for enablement config. */
  workspace?: string
  packageRoot?: string
}

type SkillTarget = {
  id: string
  skillName: string
  sourceSkillFile: string
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

function platformMediaSkillTarget(packageRoot: string): SkillTarget {
  return {
    id: PLATFORM_MEDIA_SKILL_ID,
    skillName: platformMediaSkillName(),
    sourceSkillFile: platformMediaSkillSourcePath(packageRoot),
  }
}

/** @deprecated path helper used by tests — studio skills only */
function skillPaths(studioId: StudioId, packageRoot: string, userPaths: UserPathOptions = {}) {
  return skillPathsFor(studioSkillTarget(studioId, packageRoot), userPaths)
}

async function preflightSkill(target: SkillTarget, userPaths: UserPathOptions = {}) {
  const paths = skillPathsFor(target, userPaths)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)
  if (existingDigest && !marker) {
    throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  }
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  }
  if (marker && marker.studioId !== target.id) {
    throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)
  }
}

async function writeManagedSkill(input: { target: SkillTarget; packageRoot: string; packageVersion: string; userPaths?: UserPathOptions }) {
  const paths = skillPathsFor(input.target, input.userPaths)
  const digest = await skillDigest(paths.sourceSkillFile)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)
  if (existingDigest && !marker) throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  }
  if (marker && marker.studioId !== input.target.id) {
    throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)
  }

  const previousSkill = existingDigest ? await readFile(paths.skillFile) : null
  const previousMarker = marker ? await readFile(paths.markerFile) : null
  const skillContent = await readFile(paths.sourceSkillFile)
  await mkdir(paths.skillDirectory, { recursive: true })
  const skillTmp = `${paths.skillFile}.${process.pid}.${randomUUID()}.tmp`
  const markerTmp = `${paths.markerFile}.${process.pid}.${randomUUID()}.tmp`
  const nextMarker: ManagedMarker = {
    studioId: input.target.id,
    packageVersion: input.packageVersion,
    digest,
  }
  try {
    await writeFile(skillTmp, skillContent, { mode: 0o644 })
    await writeFile(markerTmp, `${JSON.stringify(nextMarker, null, 2)}\n`, { mode: 0o644 })
    await rename(skillTmp, paths.skillFile)
    await rename(markerTmp, paths.markerFile)
    return { paths, previousSkill, previousMarker }
  } catch (error) {
    await rm(skillTmp, { force: true })
    await rm(markerTmp, { force: true })
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
  if (!marker) throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  if (marker.digest !== existingDigest) throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  if (marker.studioId !== target.id) throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)

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

function isManagedBuild123dEntry(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (entry.type !== "local") return false
  if (!Array.isArray(entry.command)) return false
  const command = entry.command.map(String)
  return command.some((part) => part.includes("build123d-mcp"))
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
  const projectTargets: Array<{ skillName: string; studioId: string }> = [
    { skillName: platformMediaSkillName(), studioId: PLATFORM_MEDIA_SKILL_ID },
    ...STUDIO_IDS.map((studioId) => ({ skillName: skillNameFor(studioId), studioId })),
  ]
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
    const plugins = pluginEntries(openCode).filter((entry) => {
      const base = pluginBaseName(entry)
      if (!base) return true
      if (LEGACY_PACKAGE_NAMES.some((legacy) => base === legacy || base.startsWith(`${legacy}/`))) return false
      return base !== input.meta.name && !base.startsWith(`${input.meta.name}/`)
    })
    let nextText = configWithPlugins(openCode, plugins)
    let workingValue: Record<string, unknown> = { ...openCode.value }
    if (plugins.length > 0) workingValue.plugin = plugins
    else delete workingValue.plugin
    let working = { ...openCode, text: nextText, value: workingValue }
    const mcp = mcpEntries(working)
    if (mcp[MANAGED_MCP_KEY] && isManagedBuild123dEntry(mcp[MANAGED_MCP_KEY])) {
      delete mcp[MANAGED_MCP_KEY]
      nextText = configWithMcp({ ...working, text: nextText }, Object.keys(mcp).length > 0 ? mcp : undefined)
      if (Object.keys(mcp).length > 0) workingValue = { ...workingValue, mcp }
      else {
        delete workingValue.mcp
      }
      working = { ...working, text: nextText, value: workingValue }
    }
    // If the file is only $schema, delete it entirely (project no longer needs a pin).
    const remainingKeys = Object.keys(workingValue).filter((k) => {
      if (k === "$schema") return false
      const v = workingValue[k]
      if (v === undefined) return false
      if (k === "mcp" && v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) return false
      if (k === "plugin" && Array.isArray(v) && v.length === 0) return false
      return true
    })
    if (remainingKeys.length === 0) {
      await rm(projectConfigPath, { force: true })
      cleaned.push(projectConfigPath)
    } else if (nextText !== openCode.text) {
      await atomicWriteOpenCodeConfig(projectConfigPath, nextText, openCode.exists ? openCode.text : "", {
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
 * Install OpenCode plugins, all domain skills, platform media skill, and CAD MCP.
 * Domains (cad/pcb) are always on — no enable list.
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
  const previous = await readStudioConfigFile(userPaths)
  const desiredRoots: Partial<Record<StudioId, string>> = {}
  const rootSource = input.roots ?? previous.roots
  for (const id of STUDIO_IDS) {
    if (rootSource[id]) desiredRoots[id] = rootSource[id]!
  }

  const domainRoot = await resolveWorkspace(input.workspace)

  if (!input.dryRun) {
    for (const studioId of enabled) {
      const def = getStudioDefinition(studioId)
      await resolveStudioRoot({ studioId, workspace: domainRoot, roots: desiredRoots, create: def.root.create })
    }
  }

  const platformTarget = platformMediaSkillTarget(packageRoot)
  await preflightSkill(platformTarget, userPaths)
  for (const studioId of STUDIO_IDS) {
    await preflightSkill(studioSkillTarget(studioId, packageRoot), userPaths)
  }

  const configPath = await resolveOpenCodeConfigPath(userPaths)
  const openCode = await readOpenCodeConfig(configPath)
  let plugins = [...pluginEntries(openCode)]

  const mediaGoFile = pathToFileURL(path.join(packageRoot, "dist", "media-go.js")).href
  plugins = plugins.filter((entry) => {
    const s = String(entry)
    if (s.includes("opencode-studio") || s.includes("media-go.js")) return false
    const base = pluginBaseName(entry)
    if (!base) return true
    if (LEGACY_PACKAGE_NAMES.some((legacy) => base === legacy || base.startsWith(`${legacy}/`))) return false
    return base !== meta.name && !base.startsWith(`${meta.name}/`)
  })
  plugins.push(meta.pluginSpecifier)
  // OpenCode 1.18: npm plugins need main or exports["./server"]. Subpath is not a server entry.
  plugins.push(mediaGoFile)

  let nextText = configWithPlugins(openCode, plugins)
  let workingValue: Record<string, unknown> = { ...openCode.value, plugin: plugins }
  let working = { ...openCode, text: nextText, value: workingValue }

  const mcp = mcpEntries(working)
  const existingMcp = mcp[MANAGED_MCP_KEY]
  if (existingMcp && !isManagedBuild123dEntry(existingMcp)) {
    throw new Error(`Conflict: mcp.${MANAGED_MCP_KEY} exists and is not the managed build123d-mcp entry`)
  }
  mcp[MANAGED_MCP_KEY] = { ...BUILD123D_MCP }
  nextText = configWithMcp({ ...working, text: nextText }, mcp)
  workingValue = { ...workingValue, mcp }
  working = { ...working, text: nextText, value: workingValue }

  if (input.dryRun) {
    return {
      action: "configure" as const,
      dryRun: true,
      workspace: domainRoot,
      enabled,
      plugin: meta.pluginSpecifier,
      restartRequired: true,
    }
  }

  const installed: string[] = []
  const rollbacks: Array<() => Promise<void>> = []

  try {
    {
      const result = await writeManagedSkill({
        target: platformTarget,
        packageRoot,
        packageVersion: meta.version,
        userPaths,
      })
      installed.push(PLATFORM_MEDIA_SKILL_ID)
      rollbacks.push(async () => {
        await restoreFile(result.paths.skillFile, result.previousSkill)
        await restoreFile(result.paths.markerFile, result.previousMarker)
      })
    }

    for (const studioId of enabled) {
      const result = await writeManagedSkill({
        target: studioSkillTarget(studioId, packageRoot),
        packageRoot,
        packageVersion: meta.version,
        userPaths,
      })
      installed.push(studioId)
      rollbacks.push(async () => {
        await restoreFile(result.paths.skillFile, result.previousSkill)
        await restoreFile(result.paths.markerFile, result.previousMarker)
      })
    }

    if (nextText !== openCode.text) {
      await atomicWriteOpenCodeConfig(configPath, nextText, openCode.exists ? openCode.text : "", {
        validate: input.validateOpenCode !== false,
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

    return {
      action: "configure" as const,
      dryRun: false,
      workspace: domainRoot,
      enabled,
      installed,
      removed: [] as string[],
      plugin: meta.pluginSpecifier,
      configPath: written.configPath,
      openCodeConfigPath: configPath,
      skillsHome: resolveOpenCodeSkillsHome(userPaths),
      projectScrubbed,
      restartRequired: true,
      restartOpenCode: true,
      restartHost: false,
      message: "Installed plugins, CAD/PCB skills, media skill, and build123d MCP (user-global). Restart OpenCode to load tools.",
    }
  } catch (error) {
    for (const rollback of rollbacks.reverse()) {
      await rollback().catch(() => {})
    }
    throw error
  }
}

/**
 * Uninstall managed OpenCode state (domain skills, media skill, managed MCP, package plugins).
 * CAD/PCB remain always-on in code once the package is registered again via repair.
 */
export async function removeStudios(input: LifecyclePaths & { validateOpenCode?: boolean } = {}) {
  assertNotRoot("remove")

  const userPaths = pickUserPaths(input)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const domainRoot = await resolveDomainRootOptional(input.workspace)
  const previous = await readStudioConfigFile(userPaths)
  const desiredRoots = previous.roots

  const platformTarget = platformMediaSkillTarget(packageRoot)
  const skillTargets = [platformTarget, ...STUDIO_IDS.map((id) => studioSkillTarget(id, packageRoot))]

  for (const target of skillTargets) {
    const paths = skillPathsFor(target, userPaths)
    const existingDigest = await currentSkillDigest(paths.skillFile)
    const marker = await readMarker(paths.markerFile)
    if (existingDigest && !marker) throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
    if (marker && existingDigest && marker.digest !== existingDigest) {
      throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
    }
  }

  const configPath = await resolveOpenCodeConfigPath(userPaths)
  const openCode = await readOpenCodeConfig(configPath)
  let plugins = [...pluginEntries(openCode)]
  plugins = plugins.filter((entry) => {
    const s = String(entry)
    if (s.includes("opencode-studio") || s.includes("media-go.js")) return false
    const base = pluginBaseName(entry)
    if (!base) return true
    if (LEGACY_PACKAGE_NAMES.some((legacy) => base === legacy || base.startsWith(`${legacy}/`))) return false
    return base !== meta.name && !base.startsWith(`${meta.name}/`)
  })

  let nextText = configWithPlugins(openCode, plugins)
  const workingValue: Record<string, unknown> = { ...openCode.value, plugin: plugins }
  const working = { ...openCode, text: nextText, value: workingValue }

  const mcp = mcpEntries(working)
  const existingMcp = mcp[MANAGED_MCP_KEY]
  if (existingMcp) {
    if (!isManagedBuild123dEntry(existingMcp)) {
      throw new Error(`Conflict: mcp.${MANAGED_MCP_KEY} exists and is not the managed build123d-mcp entry`)
    }
    delete mcp[MANAGED_MCP_KEY]
  }
  nextText = configWithMcp({ ...working, text: nextText }, mcp)

  const removed: string[] = []
  for (const target of skillTargets) {
    const paths = skillPathsFor(target, userPaths)
    if (!(await Bun.file(paths.skillFile).exists()) && !(await Bun.file(paths.markerFile).exists())) continue
    await removeManagedSkill(target, userPaths)
    removed.push(target.id)
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
    restartRequired: true,
    restartOpenCode: true,
    restartHost: false,
    message: "Removed managed plugins, skills, and build123d MCP. Restart OpenCode. Run repair to reinstall.",
  }
}

export async function statusStudios(input: LifecyclePaths = {}) {
  const userPaths = pickUserPaths(input)
  const domainRoot = await resolveWorkspace(input.workspace)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const config = await readStudioConfigFile(userPaths)
  const studios = []
  for (const studioId of CATALOG_ORDER) {
    const def = getStudioDefinition(studioId)
    let root: string | null = null
    let rootError: string | undefined
    try {
      root = await resolveStudioRoot({
        studioId,
        workspace: domainRoot,
        roots: config.roots,
      })
    } catch (error) {
      rootError = error instanceof Error ? error.message : String(error)
    }
    const paths = skillPaths(studioId, packageRoot, userPaths)
    const skillInstalled = await Bun.file(paths.skillFile).exists()
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
      const hasPlugin = pluginEntries(openCode).some((entry) => {
        const base = pluginBaseName(entry)
        if (!base) return false
        if (LEGACY_PACKAGE_NAMES.some((legacyName) => base === legacyName || base.startsWith(`${legacyName}/`))) return true
        return base === meta.name || base.startsWith(`${meta.name}/`)
      })
      const hasMcp = isManagedBuild123dEntry(mcpEntries(openCode)[MANAGED_MCP_KEY])
      if (hasPlugin || hasMcp) {
        checks.push({
          id: "legacy-project-opencode",
          status: "warn",
          message: `Project OpenCode config still pins studio plugin/MCP: ${projectOpenCode}`,
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
    const registered = entries.some((entry) => pluginEntryMatches(entry, meta.name) || pluginEntryMatches(entry, meta.pluginSpecifier))
    const mediaGo = entries.some((entry) => {
      const base = pluginBaseName(entry)
      const s = String(entry)
      return (
        base === `${meta.name}/media-go` || base?.endsWith("/media-go") === true || s.includes("/media-go") || s.includes("media-go.js")
      )
    })
    checks.push({
      id: "plugin-registration",
      status: registered ? "pass" : "warn",
      message: registered ? `Plugin registered in ${openCodePath}` : `Plugin not registered in ${openCodePath}`,
      repair: registered ? undefined : "Run opencode-studio repair",
    })
    checks.push({
      id: "plugin-media-go",
      status: mediaGo ? "pass" : "warn",
      message: mediaGo ? "media-go auxiliary plugin registered" : "media-go not registered",
      repair: mediaGo ? undefined : "Run opencode-studio repair",
    })
    const hasMcp = isManagedBuild123dEntry(mcpEntries(openCode)[MANAGED_MCP_KEY])
    checks.push({
      id: "mcp-build123d",
      status: hasMcp ? "pass" : "warn",
      message: hasMcp ? `build123d MCP registered in ${openCodePath}` : `build123d MCP not registered in ${openCodePath}`,
      repair: hasMcp ? undefined : "Run opencode-studio repair",
    })
  } catch (error) {
    checks.push({
      id: "plugin-registration",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    })
  }

  {
    const target = platformMediaSkillTarget(packageRoot)
    const paths = skillPathsFor(target, userPaths)
    const existingDigest = await currentSkillDigest(paths.skillFile)
    const marker = await readMarker(paths.markerFile)
    const sourceDigest = await skillDigest(paths.sourceSkillFile)
    if (!existingDigest) {
      checks.push({ id: "skill:media", status: "warn", message: `Missing skill ${paths.skillFile}`, repair: "Run opencode-studio repair" })
    } else if (!marker) {
      checks.push({ id: "skill:media", status: "fail", message: `Unmarked skill at ${paths.skillDirectory}` })
    } else if (marker.digest !== existingDigest) {
      checks.push({ id: "skill:media", status: "fail", message: `User-modified skill at ${paths.skillFile}` })
    } else if (marker.digest !== sourceDigest) {
      checks.push({ id: "skill:media", status: "warn", message: "Skill version drift for media", repair: "Run opencode-studio repair" })
    } else {
      checks.push({ id: "skill:media", status: "pass", message: "media skill installed" })
    }
    for (const engine of ["ffmpeg", "ffprobe"] as const) {
      try {
        const resolved = resolveEngine(engine)
        if (!resolved) {
          checks.push({
            id: `engine:platform:${engine}`,
            status: "fail",
            message: `${engine} missing (expected bundled with the package)`,
            repair: "Reinstall @oguzkaganozt/opencode-studio",
          })
        } else {
          checks.push({
            id: `engine:platform:${engine}`,
            status: "pass",
            message: `${engine} available (${resolved.source}: ${resolved.path})`,
          })
        }
      } catch (error) {
        checks.push({
          id: `engine:platform:${engine}`,
          status: "fail",
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  for (const studioId of STUDIO_IDS) {
    const def = getStudioDefinition(studioId)
    const target = studioSkillTarget(studioId, packageRoot)
    const paths = skillPathsFor(target, userPaths)
    const existingDigest = await currentSkillDigest(paths.skillFile)
    const marker = await readMarker(paths.markerFile)
    const sourceDigest = await skillDigest(paths.sourceSkillFile)
    if (!existingDigest) {
      checks.push({
        id: `skill:${studioId}`,
        status: "fail",
        message: `Missing skill ${paths.skillFile}`,
        repair: "Run opencode-studio repair",
      })
    } else if (!marker) {
      checks.push({ id: `skill:${studioId}`, status: "fail", message: `Unmarked skill at ${paths.skillDirectory}` })
    } else if (marker.digest !== existingDigest) {
      checks.push({ id: `skill:${studioId}`, status: "fail", message: `User-modified skill at ${paths.skillFile}` })
    } else if (marker.digest !== sourceDigest) {
      checks.push({
        id: `skill:${studioId}`,
        status: "warn",
        message: `Skill version drift for ${studioId}`,
        repair: "Run opencode-studio repair",
      })
    } else {
      checks.push({ id: `skill:${studioId}`, status: "pass", message: `${def.skill} installed` })
    }

    try {
      const root = await resolveStudioRoot({ studioId, workspace: domainRoot, roots: config.roots })
      checks.push({ id: `root:${studioId}`, status: "pass", message: root })
    } catch (error) {
      checks.push({
        id: `root:${studioId}`,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      })
    }

    for (const engine of def.requiredEngines) {
      try {
        const resolved = engine === "uv" ? await ensureUv() : resolveEngine(engine as "ffmpeg" | "ffprobe" | "tsci" | "uv")
        if (!resolved) {
          checks.push({
            id: `engine:${studioId}:${engine}`,
            status: "fail",
            message: `${engine} missing (expected bundled with the package)`,
            repair: "Reinstall @oguzkaganozt/opencode-studio",
          })
        } else {
          checks.push({
            id: `engine:${studioId}:${engine}`,
            status: "pass",
            message: `${engine} available (${resolved.source}: ${resolved.path})`,
          })
        }
      } catch (error) {
        checks.push({
          id: `engine:${studioId}:${engine}`,
          status: "fail",
          message: error instanceof Error ? error.message : String(error),
          repair: "Reinstall @oguzkaganozt/opencode-studio or install the engine on PATH",
        })
      }
    }
  }

  const host = await probeLocalStudioHost()
  checks.push({
    id: "studio-host",
    status: host.ok ? "pass" : "warn",
    message: host.ok
      ? `Studio host up at ${host.url}`
      : `Studio host not reachable at ${host.url} (start opencode serve with a project directory)`,
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
    restartRequiredHint: "After repair, restart OpenCode so plugins and skills load.",
  }
}

export function getPackageRoot() {
  return packageRootFrom(import.meta.dir)
}
