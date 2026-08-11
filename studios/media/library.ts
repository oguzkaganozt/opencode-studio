import { constants } from "node:fs"
import { lstat, open, opendir, realpath } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import { StudioError } from "../../src/core/errors"
import { isInside, resolveContainedPath, resolveUnderRoot } from "../../src/core/paths"
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

export const SKIP_DIR_NAMES = new Set([".git", "node_modules", "dist", ".venv", "__pycache__", ".opencode", ".cache"])

export async function initializeLibrary(input: { root?: string }): Promise<LibraryLayout> {
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
  try {
    const inside = resolveUnderRoot(layout.root, resolved, { allowRoot: true })
    if (inside === path.resolve(layout.root)) {
      throw new Error(`Output path must name a file inside the workspace: ${requested ?? filename}`)
    }
    return inside
  } catch (error) {
    if (error instanceof StudioError && error.code === "path_escape") {
      throw new Error(`Output path must be inside the workspace: ${requested ?? filename}`)
    }
    throw error
  }
}

export async function resolveWorkspaceFile(root: string, input: string) {
  try {
    const requested = resolveUnderRoot(root, input, { allowRoot: true })
    const { absolute, relative } = await resolveContainedPath(root, requested, { kind: "file", rejectSymlink: true })
    return { filePath: absolute, relativePath: relative }
  } catch (error) {
    if (error instanceof StudioError) {
      if (error.code === "path_escape") throw new Error(`Path must be inside the workspace: ${input}`)
      if (error.code === "path_resolves_outside") throw new Error(`Path resolves outside the workspace: ${input}`)
      if (error.code === "not_found") throw new Error(`Path not found: ${input}`)
      throw new Error(`Path is not a regular file: ${input}`)
    }
    throw error
  }
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
