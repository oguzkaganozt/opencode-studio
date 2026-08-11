import { lstat, opendir, realpath } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"

export const MEDIA_PROJECT_ID = /^[a-z0-9][a-z0-9_-]*$/

export type MediaProject = {
  id: string
  path: string
  directory: string
}

export function safeMediaProjectId(value: string) {
  if (!MEDIA_PROJECT_ID.test(value)) throw new Error("Invalid Media project id")
  return value
}

export async function resolveMediaProject(root: string, id: string): Promise<MediaProject> {
  const projectId = safeMediaProjectId(id)
  const canonicalRoot = await realpath(root)
  const candidate = path.join(canonicalRoot, projectId)
  const info = await lstat(candidate)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Media project not found: ${projectId}`)
  const directory = await realpath(candidate)
  if (!isInside(canonicalRoot, directory) || path.dirname(directory) !== canonicalRoot) {
    throw new Error(`Unsafe Media project: ${projectId}`)
  }
  return { id: projectId, path: projectId, directory }
}

export async function resolveMediaProjectDirectory(root: string, directory: string | undefined): Promise<MediaProject> {
  if (!directory || !path.isAbsolute(directory)) throw new Error("Open a Media project before using Media tools")
  const canonicalRoot = await realpath(root)
  const canonicalDirectory = await realpath(directory)
  if (!isInside(canonicalRoot, canonicalDirectory) || path.dirname(canonicalDirectory) !== canonicalRoot) {
    throw new Error(`Media tools require a project directly under ${canonicalRoot}`)
  }
  return resolveMediaProject(canonicalRoot, path.basename(canonicalDirectory))
}

export async function listMediaProjects(root: string): Promise<MediaProject[]> {
  const canonicalRoot = await realpath(root)
  const projects: MediaProject[] = []
  const entries = await opendir(canonicalRoot)
  for await (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !MEDIA_PROJECT_ID.test(entry.name)) continue
    try {
      projects.push(await resolveMediaProject(canonicalRoot, entry.name))
    } catch {
      // Ignore entries that changed or resolve unsafely during the scan.
    }
  }
  return projects.sort((left, right) => left.id.localeCompare(right.id, "en-US"))
}
