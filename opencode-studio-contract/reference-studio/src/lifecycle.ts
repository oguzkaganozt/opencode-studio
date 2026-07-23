import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { loadPackageMeta, skillDigest } from "./manifest"
import {
  atomicWriteOpenCodeConfig,
  configWithPlugins,
  pluginEntries,
  readOpenCodeConfig,
} from "./opencode-config"

export type Scope = "user" | "project"

export type LifecyclePaths = {
  scope: Scope
  configHome: string
  configFile: string
  skillDirectory: string
  skillFile: string
  markerFile: string
  sourceSkillFile: string
  projectRoot?: string
}

export type ManagedMarker = {
  studioId: string
  packageVersion: string
  digest: string
}

function absolutePath(value: string, label: string) {
  if (!value || value.includes("\0") || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  return path.normalize(value)
}

export function resolveLifecyclePaths(input: {
  scope?: Scope
  configHome?: string
  projectRoot?: string
  packageRoot: string
  env?: NodeJS.ProcessEnv
  homedir?: () => string
  skillName: string
  sourceSkillFile: string
}): LifecyclePaths {
  const scope = input.scope ?? "user"
  const env = input.env ?? process.env
  const { skillName, sourceSkillFile } = input
  let configHome: string
  if (input.configHome) {
    configHome = absolutePath(input.configHome, "config home")
  } else {
    configHome = env.XDG_CONFIG_HOME
      ? absolutePath(env.XDG_CONFIG_HOME, "XDG_CONFIG_HOME")
      : path.join((input.homedir ?? homedir)(), ".config")
  }

  if (scope === "user") {
    const skillDirectory = path.join(configHome, "opencode", "skills", skillName)
    return {
      scope,
      configHome,
      configFile: path.join(configHome, "opencode", "opencode.json"),
      skillDirectory,
      skillFile: path.join(skillDirectory, "SKILL.md"),
      markerFile: path.join(skillDirectory, ".osc-managed.json"),
      sourceSkillFile,
    }
  }

  const projectRoot = absolutePath(input.projectRoot ?? process.cwd(), "project root")
  const skillDirectory = path.join(projectRoot, ".opencode", "skills", skillName)
  return {
    scope,
    configHome,
    projectRoot,
    configFile: path.join(projectRoot, "opencode.json"),
    skillDirectory,
    skillFile: path.join(skillDirectory, "SKILL.md"),
    markerFile: path.join(skillDirectory, ".osc-managed.json"),
    sourceSkillFile,
  }
}

function pluginEntryMatches(entry: unknown, pluginSpecifier: string) {
  if (typeof entry === "string") return entry === pluginSpecifier
  if (Array.isArray(entry) && typeof entry[0] === "string") {
    return entry[0] === pluginSpecifier
  }
  return false
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

async function readMarker(markerFile: string): Promise<ManagedMarker | null> {
  try {
    const raw = JSON.parse(await readFile(markerFile, "utf8")) as Partial<ManagedMarker>
    if (
      typeof raw.studioId !== "string" ||
      typeof raw.packageVersion !== "string" ||
      typeof raw.digest !== "string"
    ) {
      return null
    }
    return { studioId: raw.studioId, packageVersion: raw.packageVersion, digest: raw.digest }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function currentSkillDigest(skillFile: string) {
  try {
    const content = await readFile(skillFile)
    return createHash("sha256").update(content).digest("hex")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export async function installStudio(input: {
  packageRoot: string
  scope?: Scope
  configHome?: string
  projectRoot?: string
  dryRun?: boolean
}) {
  const meta = await loadPackageMeta(input.packageRoot)
  const paths = resolveLifecyclePaths({
    ...input,
    skillName: meta.skillName,
    sourceSkillFile: meta.sourceSkillFile,
  })
  const digest = await skillDigest(paths.sourceSkillFile)
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)

  if (existingDigest && !marker) {
    throw new Error(`Conflict: unmarked skill already exists at ${paths.skillDirectory}`)
  }
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: skill was modified by the user at ${paths.skillFile}`)
  }
  if (marker && marker.studioId !== meta.studioId) {
    throw new Error(`Conflict: skill owned by studio '${marker.studioId}' at ${paths.skillDirectory}`)
  }

  const config = await readOpenCodeConfig(paths.configFile)
  const plugins = [...pluginEntries(config)]
  const alreadyRegistered = plugins.some((entry) => pluginEntryMatches(entry, meta.pluginSpecifier))
  if (!alreadyRegistered) plugins.push(meta.pluginSpecifier)
  const updatedConfigText = configWithPlugins(config, plugins)

  if (input.dryRun) {
    return {
      action: "install" as const,
      dryRun: true,
      paths,
      plugin: meta.pluginSpecifier,
      digest,
      registered: alreadyRegistered,
    }
  }

  const previousSkill = existingDigest ? await readFile(paths.skillFile) : null
  const previousMarker = marker ? await readFile(paths.markerFile) : null
  const skillContent = await readFile(paths.sourceSkillFile)
  await mkdir(paths.skillDirectory, { recursive: true })
  const skillTmp = `${paths.skillFile}.${process.pid}.${randomUUID()}.tmp`
  const markerTmp = `${paths.markerFile}.${process.pid}.${randomUUID()}.tmp`
  const markerPayload: ManagedMarker = {
    studioId: meta.studioId,
    packageVersion: meta.packageVersion,
    digest,
  }
  try {
    await writeFile(skillTmp, skillContent, { mode: 0o644 })
    await writeFile(markerTmp, `${JSON.stringify(markerPayload, null, 2)}\n`, { mode: 0o644 })
    await rename(skillTmp, paths.skillFile)
    await rename(markerTmp, paths.markerFile)
    if (updatedConfigText !== config.text) {
      await atomicWriteOpenCodeConfig(
        paths.configFile,
        updatedConfigText,
        config.exists ? config.text : "",
      )
    }
  } catch (error) {
    await rm(skillTmp, { force: true })
    await rm(markerTmp, { force: true })
    await restoreFile(paths.skillFile, previousSkill)
    await restoreFile(paths.markerFile, previousMarker)
    if (!previousSkill && !previousMarker) {
      await rmdir(paths.skillDirectory).catch((rmdirError: NodeJS.ErrnoException) => {
        if (rmdirError.code !== "ENOENT" && rmdirError.code !== "ENOTEMPTY") throw rmdirError
      })
    }
    throw error
  } finally {
    await rm(skillTmp, { force: true })
    await rm(markerTmp, { force: true })
  }

  return {
    action: "install" as const,
    dryRun: false,
    paths,
    plugin: meta.pluginSpecifier,
    digest,
    registered: alreadyRegistered,
  }
}

export async function removeStudio(input: {
  packageRoot: string
  scope?: Scope
  configHome?: string
  projectRoot?: string
  dryRun?: boolean
}) {
  const meta = await loadPackageMeta(input.packageRoot)
  const paths = resolveLifecyclePaths({
    ...input,
    skillName: meta.skillName,
    sourceSkillFile: meta.sourceSkillFile,
  })
  const existingDigest = await currentSkillDigest(paths.skillFile)
  const marker = await readMarker(paths.markerFile)

  if (existingDigest && !marker) {
    throw new Error(`Conflict: unmarked skill exists; refusing to remove ${paths.skillDirectory}`)
  }
  if (marker && existingDigest && marker.digest !== existingDigest) {
    throw new Error(`Conflict: user-modified skill preserved at ${paths.skillFile}`)
  }
  if (marker && marker.studioId !== meta.studioId) {
    throw new Error(`Conflict: skill owned by studio '${marker.studioId}'`)
  }

  const config = await readOpenCodeConfig(paths.configFile)
  const currentPlugins = pluginEntries(config)
  const hasRegistration = currentPlugins.some((entry) => pluginEntryMatches(entry, meta.pluginSpecifier))
  const plugins = currentPlugins.filter((entry) => !pluginEntryMatches(entry, meta.pluginSpecifier))
  const updatedConfigText = hasRegistration ? configWithPlugins(config, plugins) : config.text

  if (input.dryRun) {
    return { action: "remove" as const, dryRun: true, paths, plugin: meta.pluginSpecifier }
  }

  const skillBackup = `${paths.skillFile}.${process.pid}.${randomUUID()}.remove`
  const markerBackup = `${paths.markerFile}.${process.pid}.${randomUUID()}.remove`
  let stagedSkill = false
  let stagedMarker = false
  try {
    if (marker && existingDigest) {
      await rename(paths.skillFile, skillBackup)
      stagedSkill = true
      await rename(paths.markerFile, markerBackup)
      stagedMarker = true
    }
    if (config.exists && updatedConfigText !== config.text) {
      await atomicWriteOpenCodeConfig(paths.configFile, updatedConfigText, config.text)
    }
  } catch (error) {
    if (stagedMarker) await rename(markerBackup, paths.markerFile)
    if (stagedSkill) await rename(skillBackup, paths.skillFile)
    throw error
  }

  if (stagedSkill && stagedMarker) {
    await rm(skillBackup, { force: true })
    await rm(markerBackup, { force: true })
    await rmdir(paths.skillDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error
    })
  }

  return { action: "remove" as const, dryRun: false, paths, plugin: meta.pluginSpecifier }
}

export type DoctorCheck = {
  id: string
  status: "pass" | "warn" | "fail"
  message: string
  source?: string
  repair?: string
}

async function installedOpenCodeVersion() {
  try {
    const proc = Bun.spawn(["opencode", "--version"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`)
    const match = stdout.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)
    if (!match) throw new Error(`Unrecognized version output: ${stdout.trim()}`)
    return match[1]!
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("OpenCode executable not found")
    throw error
  }
}

export async function doctorStudio(input: {
  packageRoot: string
  scope?: Scope
  configHome?: string
  projectRoot?: string
  dataRoot?: string
  companionUrl?: string
}) {
  const meta = await loadPackageMeta(input.packageRoot)
  const paths = resolveLifecyclePaths({
    ...input,
    skillName: meta.skillName,
    sourceSkillFile: meta.sourceSkillFile,
  })
  const checks: DoctorCheck[] = []

  try {
    const installedVersion = await installedOpenCodeVersion()
    const compatible = Bun.semver.satisfies(installedVersion, `>=${meta.minimumOpenCode}`)
    checks.push({
      id: "opencode-compat",
      status: compatible ? "pass" : "fail",
      message: compatible
        ? `OpenCode ${installedVersion} satisfies minimum ${meta.minimumOpenCode}`
        : `OpenCode ${installedVersion} is below minimum ${meta.minimumOpenCode}`,
      source: `opencode --version; minimum from ${path.join(input.packageRoot, "opencode-studio.json")}`,
      repair: compatible ? undefined : `Upgrade OpenCode to ${meta.minimumOpenCode} or newer`,
    })
  } catch (error) {
    checks.push({
      id: "opencode-compat",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
      source: "opencode --version",
      repair: `Install OpenCode ${meta.minimumOpenCode} or newer`,
    })
  }

  checks.push({
    id: "manifest",
    status: "pass",
    message: `Manifest ok for ${meta.packageName}@${meta.packageVersion}`,
    source: path.join(input.packageRoot, "opencode-studio.json"),
  })

  const config = await readOpenCodeConfig(paths.configFile)
  const registered =
    config.exists &&
    pluginEntries(config).some((entry) => pluginEntryMatches(entry, meta.pluginSpecifier))
  checks.push({
    id: "plugin-registration",
    status: registered ? "pass" : "warn",
    message: registered
      ? `Plugin registered as ${meta.pluginSpecifier}`
      : "Plugin not registered in OpenCode config",
    source: paths.configFile,
    repair: registered ? undefined : `Run opencode-reference-studio install --scope ${paths.scope}`,
  })

  const marker = await readMarker(paths.markerFile)
  const digest = await currentSkillDigest(paths.skillFile)
  if (!digest) {
    checks.push({
      id: "skill",
      status: "warn",
      message: "Skill not installed",
      source: paths.skillDirectory,
      repair: `Run opencode-reference-studio install --scope ${paths.scope}`,
    })
  } else if (!marker) {
    checks.push({
      id: "skill",
      status: "fail",
      message: "Unmarked skill present",
      source: paths.skillDirectory,
      repair: "Remove or reclaim the skill directory, then reinstall",
    })
  } else if (marker.digest !== digest) {
    checks.push({
      id: "skill",
      status: "fail",
      message: "Skill content diverges from ownership marker (user-modified)",
      source: paths.skillFile,
      repair: "Preserve user edits or restore the packaged skill before reinstalling",
    })
  } else if (marker.packageVersion !== meta.packageVersion) {
    checks.push({
      id: "skill",
      status: "warn",
      message: `Skill package version drift: marker ${marker.packageVersion}, package ${meta.packageVersion}`,
      source: paths.markerFile,
      repair: "Re-run install to synchronize the managed skill",
    })
  } else {
    checks.push({
      id: "skill",
      status: "pass",
      message: "Managed skill present and unchanged",
      source: paths.skillDirectory,
    })
  }

  if (input.dataRoot) {
    try {
      const info = await stat(input.dataRoot)
      if (!info.isDirectory()) throw new Error("not a directory")
      await access(input.dataRoot, constants.R_OK | constants.X_OK)
      checks.push({
        id: "data-root",
        status: "pass",
        message: `Data Root exists: ${input.dataRoot}`,
        source: "--root / doctor --data-root",
      })
    } catch {
      checks.push({
        id: "data-root",
        status: "fail",
        message: `Data Root missing or inaccessible: ${input.dataRoot}`,
        repair: "Create the directory or pass an existing --root",
      })
    }
  }

  if (input.companionUrl) {
    try {
      const response = await fetch(new URL("/api/health", input.companionUrl), {
        signal: AbortSignal.timeout(1000),
      })
      checks.push({
        id: "companion",
        status: response.ok ? "pass" : "fail",
        message: response.ok
          ? `Companion reachable at ${input.companionUrl}`
          : `Companion health failed (${response.status})`,
        source: input.companionUrl,
      })
    } catch {
      checks.push({
        id: "companion",
        status: "warn",
        message: `Companion not reachable at ${input.companionUrl}`,
        source: input.companionUrl,
        repair: "Start the Companion with serve --root <path>",
      })
    }
  }

  checks.push({
    id: "domain-dependencies",
    status: "pass",
    message: "Reference Studio has no external domain engines",
    source: "package",
  })

  const failed = checks.some((check) => check.status === "fail")
  const warned = checks.some((check) => check.status === "warn")
  return {
    ok: !failed,
    status: failed ? ("fail" as const) : warned ? ("warn" as const) : ("pass" as const),
    paths,
    checks,
  }
}
