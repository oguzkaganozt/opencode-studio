import { constants, createReadStream } from "node:fs"
import { type FileHandle, lstat, open, opendir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { fileTypeFromBuffer } from "file-type"
import { Hono } from "hono"
import { StudioError } from "../../core/errors"
import { resolveContainedPath } from "../../core/paths"
import { safeContentDisposition, securityHeaders } from "../../core/security"

const SKIP_DIR_NAMES = new Set([".git", "node_modules", "dist", ".venv", "__pycache__", ".opencode", ".cache"])

const DETECTION_BYTES = 64 * 1024
const MAX_TEXT_PREVIEW = 1_048_576
const MAX_LIST_ENTRIES = 2_000
/** Max single range / buffered slice (bytes). Full-file GETs stream instead. */
const MAX_RANGE_BYTES = 16 * 1024 * 1024

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".sh",
  ".bash",
  ".zsh",
  ".gitignore",
  ".dockerfile",
  ".sql",
  ".graphql",
  ".svg",
  ".log",
])

export type EntryKind = "dir" | "file"
export type PreviewKind = "image" | "audio" | "video" | "text" | "none"

type FileEntry = {
  name: string
  path: string
  kind: EntryKind
  bytes?: number
  modifiedAt?: string
  mime?: string
  preview: PreviewKind
}

export class FilesError extends Error {
  constructor(
    readonly status: 400 | 404 | 413 | 416,
    message: string,
  ) {
    super(message)
  }
}

export async function resolveWorkspaceRoot(workspaceRoot: string) {
  const requested = path.resolve(workspaceRoot)
  const info = await lstat(requested)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe workspace root: ${requested}`)
  return realpath(requested)
}

export async function resolveInside(root: string, relative: string) {
  const clean = relative.replace(/^\/+/, "")
  const candidate = clean ? path.resolve(root, clean) : root
  try {
    return await resolveContainedPath(root, candidate, { allowRoot: true, rejectSymlink: true })
  } catch (error) {
    if (error instanceof StudioError) {
      if (error.code === "not_found") throw new FilesError(404, "Not found")
      if (error.code === "symlink_rejected") throw new FilesError(400, "Symlinks are not allowed")
      throw new FilesError(400, "Path escapes Studio Home")
    }
    throw error
  }
}

function previewKind(name: string, mime?: string): PreviewKind {
  if (mime?.startsWith("image/")) return "image"
  if (mime?.startsWith("audio/")) return "audio"
  if (mime?.startsWith("video/")) return "video"
  const ext = path.extname(name).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext) || name === "Dockerfile" || name === "Makefile") return "text"
  if (mime?.startsWith("text/")) return "text"
  return "none"
}

async function detectMime(filePath: string, size: number): Promise<string | undefined> {
  try {
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const header = Buffer.alloc(Math.min(size, DETECTION_BYTES))
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
      return detected?.mime
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size === 0) return null

  const startRaw = match[1]
  const endRaw = match[2]
  if (!startRaw) {
    const suffix = Number(endRaw)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(startRaw)
  if (!Number.isSafeInteger(start) || start >= size) return null
  if (!endRaw) return { start, end: size - 1 }

  const end = Number(endRaw)
  if (!Number.isSafeInteger(end) || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

async function readRange(handle: FileHandle, start: number, end: number) {
  const length = end - start + 1
  if (length > MAX_RANGE_BYTES) throw new FilesError(413, `Range exceeds ${MAX_RANGE_BYTES} bytes`)
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, start + offset)
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  return buffer.subarray(0, offset)
}

function streamFile(absolute: string, start?: number, end?: number): ReadableStream {
  const opts = start !== undefined && end !== undefined ? { start, end } : {}
  return Readable.toWeb(createReadStream(absolute, opts)) as unknown as ReadableStream
}

export async function createFilesApi(workspaceRoot: string, options?: { publicBasePath?: string }) {
  const root = await resolveWorkspaceRoot(workspaceRoot)
  const publicBasePath = (options?.publicBasePath ?? "/api/files").replace(/\/$/, "")
  const app = new Hono()

  app.get("/tree", async (ctx) => {
    const rel = ctx.req.query("path") ?? ""
    const { absolute, relative } = await resolveInside(root, rel)
    const info = await stat(absolute)
    if (!info.isDirectory()) throw new FilesError(400, "Not a directory")

    const entries: FileEntry[] = []
    let truncated = false
    const opened = await opendir(absolute)
    for await (const entry of opened) {
      if (entries.length >= MAX_LIST_ENTRIES) {
        truncated = true
        break
      }
      if (entry.isSymbolicLink()) continue
      // Hide all dotfiles (including .env) from the tree listing.
      if (entry.name.startsWith(".")) continue
      if (entry.isDirectory() && SKIP_DIR_NAMES.has(entry.name)) continue
      const childAbs = path.join(absolute, entry.name)
      const childRel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        entries.push({ name: entry.name, path: childRel, kind: "dir", preview: "none" })
        continue
      }
      if (!entry.isFile()) continue
      try {
        const childInfo = await lstat(childAbs)
        if (childInfo.isSymbolicLink() || !childInfo.isFile()) continue
        const mime = await detectMime(childAbs, childInfo.size)
        entries.push({
          name: entry.name,
          path: childRel,
          kind: "file",
          bytes: childInfo.size,
          modifiedAt: childInfo.mtime.toISOString(),
          mime,
          preview: previewKind(entry.name, mime),
        })
      } catch {
        // skip unreadable
      }
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
      return a.name.localeCompare(b.name, "en-US")
    })
    return ctx.json({ path: relative, entries, truncated })
  })

  app.get("/stat", async (ctx) => {
    const rel = ctx.req.query("path")
    if (!rel) throw new FilesError(400, "path required")
    const { absolute, relative, info } = await resolveInside(root, rel)
    if (info.isDirectory()) {
      return ctx.json({ path: relative, kind: "dir" as const, preview: "none" as const })
    }
    if (!info.isFile()) throw new FilesError(400, "Unsupported entry")
    const mime = await detectMime(absolute, info.size)
    return ctx.json({
      path: relative,
      kind: "file" as const,
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      mime,
      preview: previewKind(path.basename(relative), mime),
    })
  })

  app.get("/content", async (ctx) => {
    const rel = ctx.req.query("path")
    if (!rel) throw new FilesError(400, "path required")
    const { absolute, relative, info } = await resolveInside(root, rel)
    if (!info.isFile()) throw new FilesError(400, "Not a file")
    const mime = (await detectMime(absolute, info.size)) ?? "application/octet-stream"
    const kind = previewKind(path.basename(relative), mime)
    if (kind === "text") {
      if (info.size > MAX_TEXT_PREVIEW) {
        return ctx.json({ path: relative, preview: "text", truncated: true, bytes: info.size, text: null }, 200)
      }
      const text = await readFile(absolute, "utf8")
      return ctx.json({ path: relative, preview: "text", truncated: false, bytes: info.size, text })
    }
    return ctx.json({
      path: relative,
      preview: kind,
      bytes: info.size,
      mime,
      url: `${publicBasePath}/raw?path=${encodeURIComponent(relative)}`,
    })
  })

  app.get("/raw", async (ctx) => {
    const rel = ctx.req.query("path")
    if (!rel) throw new FilesError(400, "path required")
    const download = ctx.req.query("download") === "1"
    const { absolute, relative, info } = await resolveInside(root, rel)
    if (!info.isFile()) throw new FilesError(400, "Not a file")
    const mime = (await detectMime(absolute, info.size)) ?? "application/octet-stream"
    const size = info.size
    const range = parseRange(ctx.req.header("range"), size)
    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0",
      ...(securityHeaders() as Record<string, string>),
    }
    if (download) {
      headers["Content-Disposition"] = safeContentDisposition(path.basename(relative))
    }

    if (range === null) {
      headers["Content-Range"] = `bytes */${size}`
      return new Response(null, { status: 416, headers })
    }

    if (range) {
      const length = range.end - range.start + 1
      if (length > MAX_RANGE_BYTES) {
        // Stream large ranges instead of buffering.
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`
        headers["Content-Length"] = String(length)
        return new Response(streamFile(absolute, range.start, range.end), { status: 206, headers })
      }
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const body = await readRange(handle, range.start, range.end)
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`
        headers["Content-Length"] = String(body.length)
        return new Response(body, { status: 206, headers })
      } finally {
        await handle.close()
      }
    }

    // Full file: stream (never buffer entire payload).
    headers["Content-Length"] = String(size)
    return new Response(streamFile(absolute), { status: 200, headers })
  })

  app.onError((error, ctx) => {
    if (error instanceof FilesError) return ctx.json({ error: { message: error.message } }, error.status)
    console.error("[opencode-studio] files api:", error)
    return ctx.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 500)
  })

  return app
}
