import { constants } from "node:fs"
import { lstat, mkdir, open, opendir, realpath } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import { isInside } from "../../core/paths"
import { modalityFromMime } from "./assets"
import type { AskPermission } from "./studio-path"

export const LIBRARY_SCAN_LIMIT = 10_000
export const WORKSPACE_SCAN_MAX_DEPTH = 12
export type LibraryModality = "image" | "audio" | "video"
export type MediaModality = LibraryModality

/** Workspace-scoped media root layout (default outputs under media/). */
export type LibraryLayout = {
  root: string
  mediaDir: string
}

export type ManagedAsset = {
  filePath: string
  relativePath: string
  modality: LibraryModality
  mime: string
  bytes: number
  modifiedAt: string
}

const SKIP_DIR_NAMES = new Set([".git", "node_modules", "dist", ".venv", "__pycache__", ".opencode", ".cache"])

export async function initializeLibrary(input: { root?: string; resolveUsername?: (uid: number) => string }): Promise<LibraryLayout> {
  if (!input.root || !path.isAbsolute(input.root)) {
    throw new Error("opencode-media: workspace root must be an absolute path")
  }
  const root = await realpath(input.root)
  const info = await lstat(root)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe workspace root: ${root}`)
  const mediaDir = path.join(root, "media")
  return { root, mediaDir }
}

export function defaultOutputPath(layout: LibraryLayout, filename: string) {
  return path.join(layout.mediaDir, filename)
}

/**
 * Resolve an output path under the workspace.
 * - absolute or relative paths allowed if inside workspace
 * - bare filename or omitted → workspace/media/<filename>
 */
export function personalOutputPath(layout: LibraryLayout, requested: string | undefined, filename: string) {
  const resolved = (() => {
    if (!requested) return defaultOutputPath(layout, filename)
    if (path.isAbsolute(requested)) return path.normalize(requested)
    if (!requested.includes("/") && !requested.includes(path.sep)) {
      return path.join(layout.mediaDir, requested)
    }
    return path.resolve(layout.root, requested)
  })()
  if (!isInside(layout.root, resolved) && resolved !== layout.root) {
    throw new Error(`Output path must be inside the workspace: ${requested ?? filename}`)
  }
  if (resolved === layout.root) {
    throw new Error(`Output path must name a file inside the workspace: ${requested ?? filename}`)
  }
  return resolved
}

export async function resolveWorkspaceFile(root: string, input: string) {
  const requested = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input)
  if (!isInside(root, requested) && requested !== root) {
    throw new Error(`Path must be inside the workspace: ${input}`)
  }
  const info = await lstat(requested)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Path is not a regular file: ${input}`)
  const canonical = await realpath(requested)
  if (!isInside(root, canonical)) throw new Error(`Path resolves outside the workspace: ${input}`)
  return { filePath: canonical, relativePath: path.relative(root, canonical) }
}

async function inspectMediaFile(root: string, filePath: string): Promise<ManagedAsset> {
  const resolved = await resolveWorkspaceFile(root, filePath)
  const handle = await open(resolved.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    const header = Buffer.alloc(Math.min(info.size, 64 * 1024))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
    const modality = detected ? modalityFromMime(detected.mime) : undefined
    if (!detected || !modality) throw new Error(`Unsupported media file: ${resolved.filePath}`)
    return {
      filePath: resolved.filePath,
      relativePath: resolved.relativePath,
      modality,
      mime: detected.mime,
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    }
  } finally {
    await handle.close()
  }
}

export async function inspectManagedAsset(root: string, filePath: string) {
  return inspectMediaFile(root, filePath)
}

export async function openManagedAsset(input: {
  root: string
  workspaceRoot: string
  filePath: string
  signal: AbortSignal
  ask: AskPermission
}) {
  const resolved = await resolveWorkspaceFile(input.root, input.filePath)
  if (!isInside(input.workspaceRoot, resolved.filePath) && resolved.filePath !== input.workspaceRoot) {
    await input.ask({ permission: "external_directory", patterns: [resolved.filePath], always: [], metadata: {} })
  }
  await input.ask({
    permission: "read",
    patterns: [resolved.relativePath || path.basename(resolved.filePath)],
    always: ["*"],
    metadata: {},
  })
  input.signal.throwIfAborted()
  const handle = await open(resolved.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size === 0) throw new Error(`Media file is empty: ${resolved.filePath}`)
    const header = Buffer.alloc(Math.min(info.size, 64 * 1024))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
    const modality = detected ? modalityFromMime(detected.mime) : undefined
    if (!detected || !modality) throw new Error(`Unsupported media file: ${resolved.filePath}`)
    return {
      filePath: resolved.filePath,
      relativePath: resolved.relativePath,
      modality,
      mime: detected.mime,
      extension: detected.ext,
      bytes: info.size,
      handle,
    }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function scanDirectoryRecursive(
  directory: string,
  depth: number,
  maxDepth: number,
  filename: string | undefined,
  candidates: string[],
  scanned: number,
  scanLimit: number,
): Promise<number> {
  if (depth > maxDepth) return scanned
  try {
    const opened = await opendir(directory)
    for await (const entry of opened) {
      scanned += 1
      if (scanned > scanLimit) throw new Error(`Workspace media scan exceeds ${scanLimit} entries; narrow the filters`)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) continue
        scanned = await scanDirectoryRecursive(
          path.join(directory, entry.name),
          depth + 1,
          maxDepth,
          filename,
          candidates,
          scanned,
          scanLimit,
        )
      } else if (entry.isFile()) {
        if (filename && !entry.name.toLocaleLowerCase("en-US").includes(filename.toLocaleLowerCase("en-US"))) continue
        candidates.push(path.join(directory, entry.name))
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return scanned
    throw error
  }
  return scanned
}

export async function scanLibrary(input: {
  root: string
  modality?: LibraryModality
  filename?: string
  limit: number
  offset: number
  scanLimit?: number
  /** @deprecated ignored — workspace has no user scope */
  user?: string
  /** @deprecated ignored */
  scope?: string
}) {
  const scanLimit = input.scanLimit ?? LIBRARY_SCAN_LIMIT
  const candidates: string[] = []
  await scanDirectoryRecursive(input.root, 0, WORKSPACE_SCAN_MAX_DEPTH, input.filename, candidates, 0, scanLimit)
  candidates.sort((left, right) => path.relative(input.root, left).localeCompare(path.relative(input.root, right), "en-US"))

  const assets: ManagedAsset[] = []
  let skipped = 0
  for (const candidate of candidates) {
    if (assets.length >= input.limit) break
    try {
      const asset = await inspectMediaFile(input.root, candidate)
      if (input.modality && asset.modality !== input.modality) continue
      if (skipped < input.offset) {
        skipped += 1
        continue
      }
      assets.push(asset)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const message = error instanceof Error ? error.message : ""
        if (!message.startsWith("Unsupported media file") && !message.startsWith("Path is not a regular")) continue
      }
    }
  }
  return assets
}

export async function ensureMediaDir(layout: LibraryLayout) {
  try {
    await mkdir(layout.mediaDir, { recursive: true, mode: 0o755 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  const info = await lstat(layout.mediaDir)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe media directory: ${layout.mediaDir}`)
  return layout.mediaDir
}
