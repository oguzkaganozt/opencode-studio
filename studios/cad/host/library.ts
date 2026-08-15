import { createHash } from "node:crypto"
import { lstat, opendir, readdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../../src/core/paths"
import { ensurePublicArtifactLinks } from "./artifacts"
import { artifactRevision, expectedArtifactPartIds, ID_PATTERN, readArtifactManifest, readDesignManifest } from "./manifest"

export type DesignEntry = {
  id: string
  directory: string
  buildStatus: "built" | "unbuilt" | "stale"
  partCount: number
  revision: string | null
  renderRevision: string | null
}

export type StudioLayout = {
  /** CAD domain root (designs directory). */
  root: string
}

export const RENDER_FILE_PATTERN = /^[a-z0-9][a-z0-9_-]*\.png$/

export async function listRenders(directory: string): Promise<string[]> {
  const rendersDir = path.join(directory, "renders")
  try {
    return (await readdir(rendersDir)).filter((name) => RENDER_FILE_PATTERN.test(name)).sort()
  } catch {
    return []
  }
}

async function renderRevision(directory: string) {
  const rendersDir = path.join(directory, "renders")
  const entries = await listRenders(directory)
  const revisions = await Promise.all(entries.map(async (name) => `${name}:${(await stat(path.join(rendersDir, name))).mtimeMs}`))
  return revisions.join("|") || null
}

async function sha256(filePath: string) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
}

export async function initializeStudio(root: string): Promise<StudioLayout> {
  const canonical = await realpath(root)
  // Domain root is the designs directory (…/studio/designs); each child dir is one design.
  return { root: canonical }
}

export async function resolveDesignDirectory(layout: StudioLayout, id: string) {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid design id: ${id}`)
  const directory = path.resolve(layout.root, id)
  if (!isInside(layout.root, directory)) throw new Error(`Design id escapes designs root: ${id}`)
  try {
    const canonical = await realpath(directory)
    if (!isInside(layout.root, canonical)) throw new Error(`Design directory resolves outside designs root: ${id}`)
    return canonical
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return directory
    throw error
  }
}

export async function findDesign(layout: StudioLayout, id: string): Promise<DesignEntry | null> {
  const directory = await resolveDesignDirectory(layout, id).catch(() => null)
  if (!directory) return null
  try {
    await readDesignManifest(directory, id)
    return await inspectDesign(id, directory)
  } catch {
    return null
  }
}

export async function mapArtifactPartFiles(
  directory: string,
  files: Record<string, string>,
): Promise<Record<string, { path: string; exists: boolean }>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([format, relativePath]) => {
        const resolvedPath = path.resolve(directory, relativePath)
        return [format, { path: resolvedPath, exists: await Bun.file(resolvedPath).exists() }]
      }),
    ),
  )
}

export async function inspectDesign(id: string, directory: string): Promise<DesignEntry> {
  let partCount = 0
  let buildStatus: DesignEntry["buildStatus"] = "unbuilt"
  let revision: string | null = null
  await ensurePublicArtifactLinks(directory)
  const artifact = await readArtifactManifest(directory, id)
  if (artifact) {
    partCount = artifact.parts.length
    buildStatus = "built"
    revision = artifactRevision(artifact)
    const design = await readDesignManifest(directory, id).catch(() => null)
    if (design) {
      const designPartIds = expectedArtifactPartIds(design.parts).join(",")
      const artifactPartIds = artifact.parts
        .map((p) => p.id)
        .sort()
        .join(",")
      if (designPartIds !== artifactPartIds) buildStatus = "stale"
      for (const [source, expectedHash] of Object.entries(artifact.build.inputs)) {
        const sourcePath = path.resolve(directory, source)
        if (!isInside(directory, sourcePath) || (await sha256(sourcePath).catch(() => "missing")) !== expectedHash) {
          buildStatus = "stale"
          break
        }
      }
    }
  } else {
    const design = await readDesignManifest(directory, id).catch(() => null)
    if (design) partCount = design.parts.length
  }
  return { id, directory, buildStatus, partCount, revision, renderRevision: await renderRevision(directory) }
}

export async function scanDesigns(layout: StudioLayout): Promise<DesignEntry[]> {
  const candidates: Array<{ id: string; directory: string }> = []
  try {
    const dir = await opendir(layout.root)
    for await (const entry of dir) {
      if (!entry.isDirectory()) continue
      if (!ID_PATTERN.test(entry.name)) continue
      const directory = path.join(layout.root, entry.name)
      try {
        const info = await lstat(directory)
        if (info.isSymbolicLink()) continue
        const canonical = await realpath(directory)
        if (!isInside(layout.root, canonical)) continue
      } catch {
        continue
      }
      candidates.push({ id: entry.name, directory })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return []
  }
  const settled = await Promise.all(
    candidates.map(async ({ id, directory }) => {
      try {
        return await inspectDesign(id, directory)
      } catch {
        return null
      }
    }),
  )
  return settled.filter((entry): entry is DesignEntry => entry !== null).sort((a, b) => a.id.localeCompare(b.id))
}
