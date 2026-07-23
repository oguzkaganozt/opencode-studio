import { createHash } from "node:crypto"
import { lstat, opendir, readdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { type ArtifactManifest, artifactRevision, type DesignManifest, readArtifactManifest, readDesignManifest } from "./manifest"
import { isInside } from "./studio-path"

export type DesignEntry = {
  id: string
  directory: string
  buildStatus: "built" | "unbuilt" | "stale"
  partCount: number
  revision: string | null
  renderRevision: string | null
}

export type StudioLayout = {
  root: string
  designsRoot: string
}

const RENDER_FILE_PATTERN = /^[a-z0-9][a-z0-9_-]*\.png$/

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
  return { root: canonical, designsRoot: path.join(canonical, "designs") }
}

export async function resolveDesignDirectory(layout: StudioLayout, id: string) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid design id: ${id}`)
  const directory = path.resolve(layout.designsRoot, id)
  if (!isInside(layout.designsRoot, directory)) throw new Error(`Design id escapes designs root: ${id}`)
  try {
    const canonical = await realpath(directory)
    if (!isInside(layout.designsRoot, canonical)) throw new Error(`Design directory resolves outside designs root: ${id}`)
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
    return await inspectDesign(layout, id, directory)
  } catch {
    return null
  }
}

export async function inspectDesign(_layout: StudioLayout, id: string, directory: string): Promise<DesignEntry> {
  let partCount = 0
  let buildStatus: DesignEntry["buildStatus"] = "unbuilt"
  let revision: string | null = null
  const artifact = await readArtifactManifest(directory, id)
  if (artifact) {
    partCount = artifact.parts.length
    buildStatus = "built"
    revision = artifactRevision(artifact)
    const design = await readDesignManifest(directory, id).catch(() => null)
    if (design) {
      const designPartIds = design.parts
        .map((p) => p.id)
        .sort()
        .join(",")
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
  const entries: DesignEntry[] = []
  try {
    const dir = await opendir(layout.designsRoot)
    for await (const entry of dir) {
      if (!entry.isDirectory()) continue
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(entry.name)) continue
      const directory = path.join(layout.designsRoot, entry.name)
      try {
        const info = await lstat(directory)
        if (info.isSymbolicLink()) continue
        const canonical = await realpath(directory)
        if (!isInside(layout.designsRoot, canonical)) continue
      } catch {
        continue
      }
      try {
        entries.push(await inspectDesign(layout, entry.name, directory))
      } catch {}
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return entries
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return entries
}

export async function readDesignWithArtifact(
  layout: StudioLayout,
  id: string,
): Promise<{ design: DesignManifest; artifact: ArtifactManifest | null; directory: string } | null> {
  const directory = await resolveDesignDirectory(layout, id)
  try {
    const design = await readDesignManifest(directory, id)
    const artifact = await readArtifactManifest(directory, id)
    return { design, artifact, directory }
  } catch {
    return null
  }
}
