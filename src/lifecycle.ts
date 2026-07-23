import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { defaultMediaRoot, parseStudioConfig, readStudioConfigFile, resolveStudioRoot, writeStudioConfigFile } from "./config"
import {
  atomicWriteOpenCodeConfig,
  configWithMcp,
  configWithPlugins,
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
  skillDigest,
  skillNameFor,
  skillSourcePath,
} from "./core/package-meta"
import { packageRootFrom, resolveWorkspace } from "./core/paths"
import type { StudioDoctorCheck, StudioId } from "./core/registry"
import { CATALOG_ORDER, STUDIO_IDS } from "./core/registry"
import { assertNotRoot } from "./core/security"
import { getStudioDefinition } from "./studios"

export type ManagedMarker = {
  studioId: string
  packageVersion: string
  digest: string
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
    return createHash("sha256")
      .update(await readFile(skillFile))
      .digest("hex")
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

function skillPaths(workspace: string, studioId: StudioId, packageRoot: string) {
  const skillName = skillNameFor(studioId)
  const skillDirectory = path.join(workspace, ".opencode", "skills", skillName)
  return {
    skillName,
    skillDirectory,
    skillFile: path.join(skillDirectory, "SKILL.md"),
    markerFile: path.join(skillDirectory, MANAGED_MARKER_NAME),
    sourceSkillFile: skillSourcePath(packageRoot, studioId),
  }
}

async function preflightSkill(workspace: string, studioId: StudioId, packageRoot: string) {
  const paths = skillPaths(workspace, studioId, packageRoot)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)
  if (existingDigest && !marker) {
    throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  }
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  }
  if (marker && marker.studioId !== studioId) {
    throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)
  }
}

async function writeManagedSkill(input: { workspace: string; studioId: StudioId; packageRoot: string; packageVersion: string }) {
  const paths = skillPaths(input.workspace, input.studioId, input.packageRoot)
  const digest = await skillDigest(paths.sourceSkillFile)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)
  if (existingDigest && !marker) throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  }
  if (marker && marker.studioId !== input.studioId) {
    throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)
  }

  const previousSkill = existingDigest ? await readFile(paths.skillFile) : null
  const previousMarker = marker ? await readFile(paths.markerFile) : null
  const skillContent = await readFile(paths.sourceSkillFile)
  await mkdir(paths.skillDirectory, { recursive: true })
  const skillTmp = `${paths.skillFile}.${process.pid}.${randomUUID()}.tmp`
  const markerTmp = `${paths.markerFile}.${process.pid}.${randomUUID()}.tmp`
  const nextMarker: ManagedMarker = {
    studioId: input.studioId,
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

async function removeManagedSkill(workspace: string, studioId: StudioId, packageRoot: string) {
  const paths = skillPaths(workspace, studioId, packageRoot)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  if (!existingDigest) {
    await rm(paths.markerFile, { force: true })
    await rmdir(paths.skillDirectory).catch(() => {})
    return
  }
  const marker = await readMarker(paths.markerFile)
  if (!marker) throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  if (marker.digest !== existingDigest) throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  if (marker.studioId !== studioId) throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)

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

export async function configureStudios(input: {
  workspace?: string
  enabled: string[]
  roots?: Partial<Record<StudioId, string>>
  packageRoot?: string
  dryRun?: boolean
  validateOpenCode?: boolean
}) {
  assertNotRoot("configure")

  const workspace = await resolveWorkspace(input.workspace)
  const enabled = parseStudioConfig({ enabled: input.enabled, roots: input.roots }).enabled
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const previous = await readStudioConfigFile(workspace)
  const desiredRoots = input.roots ?? previous.roots

  // Preflight roots
  for (const studioId of enabled) {
    const _def = getStudioDefinition(studioId)
    if (studioId === "media") {
      const root = desiredRoots.media ?? defaultMediaRoot()
      if (input.dryRun) continue
      await resolveStudioRoot({ studioId, workspace, roots: { ...desiredRoots, media: root }, createMedia: true })
    } else {
      await resolveStudioRoot({ studioId, workspace, roots: desiredRoots, createMedia: false })
    }
  }

  // Preflight skills for enable and disable
  for (const studioId of STUDIO_IDS) {
    const paths = skillPaths(workspace, studioId, packageRoot)
    const existingDigest = await currentSkillDigest(paths.skillFile)
    const marker = await readMarker(paths.markerFile)
    if (!enabled.includes(studioId)) {
      if (existingDigest && !marker) throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
      if (marker && existingDigest && marker.digest !== existingDigest) {
        throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
      }
    } else {
      await preflightSkill(workspace, studioId, packageRoot)
    }
  }

  const configPath = await resolveOpenCodeConfigPath(workspace)
  const openCode = await readOpenCodeConfig(configPath)
  let plugins = [...pluginEntries(openCode)]

  // Strip any previous opencode-studio plugin entries (any version / subpath)
  plugins = plugins.filter((entry) => {
    const base = pluginBaseName(entry)
    if (!base) return true
    return base !== meta.name && !base.startsWith(`${meta.name}/`)
  })
  plugins.push(meta.pluginSpecifier)
  // Media owns an auxiliary OpenCode plugin export for the opencode-go provider hook.
  if (enabled.includes("media")) {
    plugins.push(`${meta.name}@${meta.version}/media-go`)
  }

  let nextText = configWithPlugins(openCode, plugins)
  let workingValue: Record<string, unknown> = { ...openCode.value, plugin: plugins }
  let working = { ...openCode, text: nextText, value: workingValue }

  // CAD MCP management
  const mcp = mcpEntries(working)
  const existingMcp = mcp[MANAGED_MCP_KEY]
  if (enabled.includes("cad")) {
    if (existingMcp && !isManagedBuild123dEntry(existingMcp)) {
      throw new Error(`Conflict: mcp.${MANAGED_MCP_KEY} exists and is not the managed build123d-mcp entry`)
    }
    mcp[MANAGED_MCP_KEY] = { ...BUILD123D_MCP }
  } else if (existingMcp) {
    if (!isManagedBuild123dEntry(existingMcp)) {
      throw new Error(`Conflict: mcp.${MANAGED_MCP_KEY} exists and is not the managed build123d-mcp entry`)
    }
    delete mcp[MANAGED_MCP_KEY]
  }
  nextText = configWithMcp({ ...working, text: nextText }, mcp)
  workingValue = { ...workingValue, mcp }
  working = { ...working, text: nextText, value: workingValue }

  if (input.dryRun) {
    return {
      action: "configure" as const,
      dryRun: true,
      workspace,
      enabled,
      plugin: meta.pluginSpecifier,
      restartRequired: true,
    }
  }

  const installed: StudioId[] = []
  const removed: StudioId[] = []
  const rollbacks: Array<() => Promise<void>> = []

  try {
    for (const studioId of enabled) {
      const result = await writeManagedSkill({
        workspace,
        studioId,
        packageRoot,
        packageVersion: meta.version,
      })
      installed.push(studioId)
      rollbacks.push(async () => {
        await restoreFile(result.paths.skillFile, result.previousSkill)
        await restoreFile(result.paths.markerFile, result.previousMarker)
      })
    }
    for (const studioId of STUDIO_IDS) {
      if (enabled.includes(studioId)) continue
      const paths = skillPaths(workspace, studioId, packageRoot)
      if (!(await Bun.file(paths.skillFile).exists()) && !(await Bun.file(paths.markerFile).exists())) continue
      await removeManagedSkill(workspace, studioId, packageRoot)
      removed.push(studioId)
    }

    if (nextText !== openCode.text) {
      await atomicWriteOpenCodeConfig(configPath, nextText, openCode.exists ? openCode.text : "", {
        validate: input.validateOpenCode !== false,
      })
    }

    await writeStudioConfigFile(workspace, {
      enabled,
      roots: Object.keys(desiredRoots).length > 0 ? desiredRoots : undefined,
    })

    return {
      action: "configure" as const,
      dryRun: false,
      workspace,
      enabled,
      installed,
      removed,
      plugin: meta.pluginSpecifier,
      configPath: path.join(workspace, ".opencode", "studio.json"),
      openCodeConfigPath: configPath,
      restartRequired: true,
      message: "Configuration applied. Restart OpenCode and opencode-studio serve.",
    }
  } catch (error) {
    for (const rollback of rollbacks.reverse()) {
      await rollback().catch(() => {})
    }
    throw error
  }
}

export async function removeStudios(input: { workspace?: string; packageRoot?: string; validateOpenCode?: boolean }) {
  return configureStudios({
    workspace: input.workspace,
    enabled: [],
    packageRoot: input.packageRoot,
    validateOpenCode: input.validateOpenCode,
  })
}

export async function statusStudios(input: { workspace?: string; packageRoot?: string }) {
  const workspace = await resolveWorkspace(input.workspace)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const config = await readStudioConfigFile(workspace)
  const studios = []
  for (const studioId of CATALOG_ORDER) {
    const def = getStudioDefinition(studioId)
    let root: string | null = null
    let rootError: string | undefined
    try {
      root = await resolveStudioRoot({
        studioId,
        workspace,
        roots: config.roots,
        createMedia: false,
      })
    } catch (error) {
      rootError = error instanceof Error ? error.message : String(error)
    }
    const paths = skillPaths(workspace, studioId, packageRoot)
    const skillInstalled = await Bun.file(paths.skillFile).exists()
    studios.push({
      id: studioId,
      label: def.label,
      description: def.description,
      enabled: config.enabled.includes(studioId),
      root,
      rootError,
      requiredEngines: def.requiredEngines,
      skill: skillNameFor(studioId),
      skillInstalled,
    })
  }
  return {
    workspace,
    configPath: config.configPath,
    configError: config.error,
    enabled: config.enabled,
    plugin: meta.pluginSpecifier,
    studios,
    restartRequiredHint: "After configure changes, restart OpenCode and opencode-studio serve.",
  }
}

function commandExists(command: string) {
  return Boolean(Bun.which(command))
}

export async function doctorStudios(input: { workspace?: string; packageRoot?: string }) {
  const workspace = await resolveWorkspace(input.workspace)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const config = await readStudioConfigFile(workspace)
  const checks: StudioDoctorCheck[] = []

  checks.push({
    id: "package",
    status: "pass",
    message: `${meta.name}@${meta.version}`,
  })

  if (config.error) {
    checks.push({
      id: "config",
      status: "fail",
      message: config.error,
      repair: "Fix or remove .opencode/studio.json",
    })
  } else {
    checks.push({
      id: "config",
      status: "pass",
      message: config.enabled.length === 0 ? "No Studios enabled (fail-closed)" : `Enabled: ${config.enabled.join(", ")}`,
    })
  }

  const openCodePath = await resolveOpenCodeConfigPath(workspace)
  try {
    const openCode = await readOpenCodeConfig(openCodePath)
    const registered = pluginEntries(openCode).some(
      (entry) => pluginEntryMatches(entry, meta.name) || pluginEntryMatches(entry, meta.pluginSpecifier),
    )
    checks.push({
      id: "plugin-registration",
      status: registered || config.enabled.length === 0 ? "pass" : "warn",
      message: registered ? `Plugin registered in ${openCodePath}` : `Plugin not registered in ${openCodePath}`,
      repair: registered ? undefined : "Run opencode-studio configure <studios...>",
    })
  } catch (error) {
    checks.push({
      id: "plugin-registration",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    })
  }

  for (const studioId of config.enabled) {
    const def = getStudioDefinition(studioId)
    const paths = skillPaths(workspace, studioId, packageRoot)
    const existingDigest = await currentSkillDigest(paths.skillFile)
    const marker = await readMarker(paths.markerFile)
    const sourceDigest = await skillDigest(paths.sourceSkillFile)
    if (!existingDigest) {
      checks.push({ id: `skill:${studioId}`, status: "fail", message: `Missing skill ${paths.skillFile}`, repair: "Re-run configure" })
    } else if (!marker) {
      checks.push({ id: `skill:${studioId}`, status: "fail", message: `Unmarked skill at ${paths.skillDirectory}` })
    } else if (marker.digest !== existingDigest) {
      checks.push({ id: `skill:${studioId}`, status: "fail", message: `User-modified skill at ${paths.skillFile}` })
    } else if (marker.digest !== sourceDigest) {
      checks.push({ id: `skill:${studioId}`, status: "warn", message: `Skill version drift for ${studioId}`, repair: "Re-run configure" })
    } else {
      checks.push({ id: `skill:${studioId}`, status: "pass", message: `${def.skill} installed` })
    }

    try {
      const root = await resolveStudioRoot({ studioId, workspace, roots: config.roots, createMedia: false })
      checks.push({ id: `root:${studioId}`, status: "pass", message: root })
    } catch (error) {
      checks.push({
        id: `root:${studioId}`,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      })
    }

    for (const engine of def.requiredEngines) {
      const ok = commandExists(engine)
      checks.push({
        id: `engine:${studioId}:${engine}`,
        status: ok ? "pass" : "warn",
        message: ok ? `${engine} available` : `${engine} not found on PATH`,
      })
    }
  }

  const failed = checks.some((check) => check.status === "fail")
  return { workspace, package: meta.pluginSpecifier, checks, ok: !failed }
}

export function getPackageRoot() {
  return packageRootFrom(import.meta.dir)
}
