import { lstat, opendir, readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"
import { type FwCapability, type FwChip, type FwEngine, fwChipSpec, isFwChip } from "./chips"

export const FW_PROJECT_ID = /^[a-z0-9][a-z0-9_-]*$/

export type FwProjectManifest = {
  id: string
  name: string
  chip: FwChip
}

export type FwBuildRecord = {
  ok: boolean
  finishedAt: string
  exitCode: number | null
  logPath: string
}

export type FwRunRecord = {
  ok: boolean
  reason: "expect" | "fail" | "timeout" | "exit" | "abort"
  engine: FwEngine
  chip: FwChip
  expect?: string
  fail?: string
  matched?: string
  durationMs: number
  finishedAt: string
  exitCode: number | null
  logPath: string
}

export type FwProject = {
  id: string
  path: string
  directory: string
  chip: FwChip
  engine: FwEngine
  capabilities: readonly FwCapability[]
  manifest: FwProjectManifest
}

export function safeFwProjectId(value: string) {
  if (!FW_PROJECT_ID.test(value)) throw new Error("Invalid Firmware project id")
  return value
}

export function projectJsonPath(directory: string) {
  return path.join(directory, "project.json")
}

export function simDir(directory: string) {
  return path.join(directory, "sim")
}

export function uartLogPath(directory: string) {
  return path.join(simDir(directory), "uart.log")
}

export function buildLogPath(directory: string) {
  return path.join(simDir(directory), "build.log")
}

export function buildRecordPath(directory: string) {
  return path.join(simDir(directory), "build.json")
}

export function runRecordPath(directory: string) {
  return path.join(simDir(directory), "last.json")
}

export async function readManifest(directory: string): Promise<FwProjectManifest> {
  const raw = JSON.parse(await readFile(projectJsonPath(directory), "utf8")) as Partial<FwProjectManifest>
  if (!raw.id || !FW_PROJECT_ID.test(raw.id)) throw new Error("Invalid project.json id")
  if (!raw.chip || !isFwChip(raw.chip)) throw new Error("Invalid project.json chip")
  return { id: raw.id, name: raw.name?.trim() ? raw.name : raw.id, chip: raw.chip }
}

export async function resolveFwProject(root: string, id: string): Promise<FwProject> {
  const projectId = safeFwProjectId(id)
  const canonicalRoot = await realpath(root)
  const candidate = path.join(canonicalRoot, projectId)
  const info = await lstat(candidate)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Firmware project not found: ${projectId}`)
  const directory = await realpath(candidate)
  if (!isInside(canonicalRoot, directory) || path.dirname(directory) !== canonicalRoot) {
    throw new Error(`Unsafe Firmware project: ${projectId}`)
  }
  const manifest = await readManifest(directory)
  const spec = fwChipSpec(manifest.chip)
  return {
    id: projectId,
    path: projectId,
    directory,
    chip: spec.chip,
    engine: spec.engine,
    capabilities: spec.capabilities,
    manifest,
  }
}

export async function listFwProjects(root: string): Promise<FwProject[]> {
  const canonicalRoot = await realpath(root)
  const projects: FwProject[] = []
  const entries = await opendir(canonicalRoot)
  for await (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !FW_PROJECT_ID.test(entry.name)) continue
    try {
      projects.push(await resolveFwProject(canonicalRoot, entry.name))
    } catch {
      // Ignore entries that changed or resolve unsafely during the scan.
    }
  }
  return projects.sort((left, right) => left.id.localeCompare(right.id, "en-US"))
}

export async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T
  } catch {
    return null
  }
}
