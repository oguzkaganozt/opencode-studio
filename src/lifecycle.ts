import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  defaultMediaRoot,
  legacyStudioConfigPath,
  parseStudioConfig,
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
  skillDigest,
  skillNameFor,
  skillSourcePath,
} from "./core/package-meta"
import { packageRootFrom, resolveWorkspace } from "./core/paths"
import type { StudioDoctorCheck, StudioId } from "./core/registry"
import { CATALOG_ORDER, STUDIO_IDS } from "./core/registry"
import { assertNotRoot } from "./core/security"
import { pickUserPaths, resolveOpenCodeSkillsHome, type UserPathOptions } from "./core/user-paths"
import { getStudioDefinition } from "./studios"

export type ManagedMarker = {
  studioId: string
  packageVersion: string
  digest: string
}

export type LifecyclePaths = UserPathOptions & {
  /** Domain data root (CAD/PCB/startup). Defaults to cwd. Not used for enablement config. */
  workspace?: string
  packageRoot?: string
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

function skillPaths(studioId: StudioId, packageRoot: string, userPaths: UserPathOptions = {}) {
  const skillName = skillNameFor(studioId)
  const skillDirectory = path.join(resolveOpenCodeSkillsHome(userPaths), skillName)
  return {
    skillName,
    skillDirectory,
    skillFile: path.join(skillDirectory, "SKILL.md"),
    markerFile: path.join(skillDirectory, MANAGED_MARKER_NAME),
    sourceSkillFile: skillSourcePath(packageRoot, studioId),
  }
}

async function preflightSkill(studioId: StudioId, packageRoot: string, userPaths: UserPathOptions = {}) {
  const paths = skillPaths(studioId, packageRoot, userPaths)
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

async function writeManagedSkill(input: { studioId: StudioId; packageRoot: string; packageVersion: string; userPaths?: UserPathOptions }) {
  const paths = skillPaths(input.studioId, input.packageRoot, input.userPaths)
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

async function removeManagedSkill(studioId: StudioId, packageRoot: string, userPaths: UserPathOptions = {}) {
  const paths = skillPaths(studioId, packageRoot, userPaths)
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
  for (const studioId of STUDIO_IDS) {
    const skillName = skillNameFor(studioId)
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
    let workingValue: Record<string, unknown> = { ...openCode.value, plugin: plugins }
    let working = { ...openCode, text: nextText, value: workingValue }
    const mcp = mcpEntries(working)
    if (mcp[MANAGED_MCP_KEY] && isManagedBuild123dEntry(mcp[MANAGED_MCP_KEY])) {
      delete mcp[MANAGED_MCP_KEY]
      nextText = configWithMcp({ ...working, text: nextText }, mcp)
      workingValue = { ...workingValue, mcp }
      working = { ...working, text: nextText, value: workingValue }
    }
    if (nextText !== openCode.text) {
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
  return cleaned
}

export async function configureStudios(
  input: {
    enabled: string[]
    roots?: Partial<Record<StudioId, string>>
    dryRun?: boolean
    validateOpenCode?: boolean
  } & LifecyclePaths,
) {
  assertNotRoot("configure")

  const userPaths = pickUserPaths(input)
  const enabled = parseStudioConfig({ enabled: input.enabled, roots: input.roots }).enabled
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const previous = await readStudioConfigFile(userPaths)
  const desiredRoots = input.roots ?? previous.roots

  // Domain root is data-local. Optional when clearing all studios (remove).
  let domainRoot: string | null
  if (enabled.length === 0) {
    domainRoot = await resolveDomainRootOptional(input.workspace)
  } else {
    domainRoot = await resolveWorkspace(input.workspace)
  }

  // Preflight domain roots (data local)
  if (domainRoot) {
    for (const studioId of enabled) {
      const def = getStudioDefinition(studioId)
      if (input.dryRun) continue
      const roots =
        def.root.default === "user-data" ? { ...desiredRoots, [studioId]: desiredRoots[studioId] ?? defaultMediaRoot() } : desiredRoots
      await resolveStudioRoot({ studioId, workspace: domainRoot, roots, create: def.root.create })
    }
  }

  // Preflight skills for enable and disable
  for (const studioId of STUDIO_IDS) {
    const paths = skillPaths(studioId, packageRoot, userPaths)
    const existingDigest = await currentSkillDigest(paths.skillFile)
    const marker = await readMarker(paths.markerFile)
    if (!enabled.includes(studioId)) {
      if (existingDigest && !marker) throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
      if (marker && existingDigest && marker.digest !== existingDigest) {
        throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
      }
    } else {
      await preflightSkill(studioId, packageRoot, userPaths)
    }
  }

  const configPath = await resolveOpenCodeConfigPath(userPaths)
  const openCode = await readOpenCodeConfig(configPath)
  let plugins = [...pluginEntries(openCode)]

  // Strip current + legacy package plugin entries (any version / subpath)
  plugins = plugins.filter((entry) => {
    const base = pluginBaseName(entry)
    if (!base) return true
    if (LEGACY_PACKAGE_NAMES.some((legacy) => base === legacy || base.startsWith(`${legacy}/`))) return false
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
      workspace: domainRoot ?? undefined,
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
        studioId,
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
    for (const studioId of STUDIO_IDS) {
      if (enabled.includes(studioId)) continue
      const paths = skillPaths(studioId, packageRoot, userPaths)
      if (!(await Bun.file(paths.skillFile).exists()) && !(await Bun.file(paths.markerFile).exists())) continue
      await removeManagedSkill(studioId, packageRoot, userPaths)
      removed.push(studioId)
    }

    if (nextText !== openCode.text) {
      await atomicWriteOpenCodeConfig(configPath, nextText, openCode.exists ? openCode.text : "", {
        validate: input.validateOpenCode !== false,
      })
    }

    const written = await writeStudioConfigFile(
      {
        enabled,
        roots: Object.keys(desiredRoots).length > 0 ? desiredRoots : undefined,
      },
      userPaths,
    )

    let projectScrubbed: string[] = []
    if (domainRoot) {
      try {
        projectScrubbed = await scrubProjectLocalManagedState({
          domainRoot,
          packageRoot,
          meta,
          validateOpenCode: input.validateOpenCode,
        })
      } catch {
        // Non-fatal: global config already applied; doctor will surface leftovers.
      }
    }

    return {
      action: "configure" as const,
      dryRun: false,
      workspace: domainRoot ?? undefined,
      enabled,
      installed,
      removed,
      plugin: meta.pluginSpecifier,
      configPath: written.configPath,
      openCodeConfigPath: configPath,
      skillsHome: resolveOpenCodeSkillsHome(userPaths),
      projectScrubbed,
      restartRequired: true,
      restartOpenCode: true,
      // Host hot-reloads when configure is applied via the running serve UI/API.
      restartHost: true,
      message:
        "Configuration applied (user-global). Restart OpenCode. If serve is running, it reloads on Apply from the home UI; otherwise restart serve too.",
    }
  } catch (error) {
    for (const rollback of rollbacks.reverse()) {
      await rollback().catch(() => {})
    }
    throw error
  }
}

export async function removeStudios(input: LifecyclePaths & { validateOpenCode?: boolean } = {}) {
  return configureStudios({
    ...input,
    enabled: [],
  })
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
        createMedia: false,
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
      enabled: config.enabled.includes(studioId),
      root,
      rootError,
      requiredEngines: def.requiredEngines,
      skill: skillNameFor(studioId),
      skillInstalled,
    })
  }
  return {
    workspace: domainRoot,
    configPath: config.configPath,
    configHome: config.configHome,
    configError: config.error,
    enabled: config.enabled,
    plugin: meta.pluginSpecifier,
    studios,
    restartRequiredHint: "After configure changes, restart OpenCode. The studio host hot-reloads when you Apply from the home UI.",
  }
}

export async function doctorStudios(input: LifecyclePaths = {}) {
  const userPaths = pickUserPaths(input)
  const domainRoot = await resolveWorkspace(input.workspace)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const config = await readStudioConfigFile(userPaths)
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
      repair: `Fix or remove ${config.configPath}`,
    })
  } else {
    checks.push({
      id: "config",
      status: "pass",
      message:
        config.enabled.length === 0
          ? `No Studios enabled (fail-closed) — ${config.configPath}`
          : `Enabled: ${config.enabled.join(", ")} (${config.configPath})`,
    })
  }

  // Upgrade leftovers under the domain root
  const legacyPath = legacyStudioConfigPath(domainRoot)
  const legacy = await readLegacyStudioConfig(domainRoot)
  if (legacy) {
    checks.push({
      id: "legacy-project-config",
      status: "warn",
      message: `Legacy project config still present: ${legacyPath}`,
      repair: "Run opencode-studio configure <studios...> (scrubs project files) or delete the legacy path",
    })
  }
  for (const studioId of STUDIO_IDS) {
    const skillDir = path.join(domainRoot, ".opencode", "skills", skillNameFor(studioId))
    if (await Bun.file(path.join(skillDir, "SKILL.md")).exists()) {
      checks.push({
        id: `legacy-project-skill:${studioId}`,
        status: "warn",
        message: `Project-local skill leftover: ${skillDir}`,
        repair: "Run opencode-studio configure … to scrub, or delete the directory",
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
          repair: "Run opencode-studio configure … to scrub managed entries, or edit the file",
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
    const paths = skillPaths(studioId, packageRoot, userPaths)
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
      const root = await resolveStudioRoot({ studioId, workspace: domainRoot, roots: config.roots, createMedia: false })
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

  const failed = checks.some((check) => check.status === "fail")
  return {
    workspace: domainRoot,
    configPath: config.configPath,
    package: meta.pluginSpecifier,
    checks,
    ok: !failed,
  }
}

export function getPackageRoot() {
  return packageRootFrom(import.meta.dir)
}
