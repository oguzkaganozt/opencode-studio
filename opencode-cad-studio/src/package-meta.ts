import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type StudioManifest = {
  schemaVersion: 1
  id: string
  contractVersion: string
  minimumOpenCode: string
  plugin: string
  skill: string
}

export const DEFAULT_PORT = 4173

export function packageRootFrom(importMetaDir: string) {
  const base = path.basename(importMetaDir)
  return base === "dist" || base === "src" ? path.resolve(importMetaDir, "..") : importMetaDir
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

export function validateManifest(value: unknown): asserts value is StudioManifest {
  if (!value || typeof value !== "object") throw new Error("Manifest must be an object")
  const manifest = value as Record<string, unknown>
  const required = ["schemaVersion", "id", "contractVersion", "minimumOpenCode", "plugin", "skill"]
  for (const key of required) {
    if (!(key in manifest)) throw new Error(`Manifest missing required field: ${key}`)
  }
  for (const key of Object.keys(manifest)) {
    if (!required.includes(key)) throw new Error(`Manifest has unknown field: ${key}`)
  }
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be 1")
  if (typeof manifest.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(manifest.id)) {
    throw new Error("Invalid manifest id")
  }
  if (
    typeof manifest.contractVersion !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.contractVersion)
  ) {
    throw new Error("Invalid contractVersion")
  }
  if (typeof manifest.minimumOpenCode !== "string" || !manifest.minimumOpenCode) {
    throw new Error("Invalid minimumOpenCode")
  }
  if (typeof manifest.plugin !== "string" || !manifest.plugin) throw new Error("Invalid plugin")
  if (typeof manifest.skill !== "string" || !/^\.\.?\/.*/.test(manifest.skill)) {
    throw new Error("Invalid skill path")
  }
}

export async function loadPackageMeta(packageRoot: string) {
  const packageJson = await readJson<{ name: string; version: string }>(path.join(packageRoot, "package.json"))
  const manifest = await readJson<StudioManifest>(path.join(packageRoot, "opencode-studio.json"))
  validateManifest(manifest)
  const pluginExport = manifest.plugin.replace(/^\.\//, "")
  const pluginSpecifier = pluginExport === "." || pluginExport === "" ? packageJson.name : `${packageJson.name}/${pluginExport}`
  const skillDirRelative = manifest.skill
  const skillName = path.basename(path.normalize(skillDirRelative))
  if (!skillName || skillName === "." || skillName === "..") {
    throw new Error(`Invalid manifest skill path: ${manifest.skill}`)
  }
  const sourceSkillDirectory = path.resolve(packageRoot, skillDirRelative)
  const packageRootResolved = path.resolve(packageRoot)
  if (!sourceSkillDirectory.startsWith(packageRootResolved + path.sep) && sourceSkillDirectory !== packageRootResolved) {
    throw new Error(`Manifest skill path escapes package root: ${manifest.skill}`)
  }
  return {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    manifest,
    pluginSpecifier,
    skillName,
    skillDirRelative,
    sourceSkillDirectory,
    sourceSkillFile: path.join(sourceSkillDirectory, "SKILL.md"),
    contractVersion: manifest.contractVersion,
    studioId: manifest.id,
    minimumOpenCode: manifest.minimumOpenCode,
  }
}

export async function skillDigest(skillMarkdownPath: string) {
  const content = await readFile(skillMarkdownPath)
  return createHash("sha256").update(content).digest("hex")
}
