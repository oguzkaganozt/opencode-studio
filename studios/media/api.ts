import { constants } from "node:fs"
import { type FileHandle, lstat, open } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import { Hono } from "hono"
import { modalityFromMime } from "./assets"
import {
  currentUnixUsername,
  type LibraryModality,
  type LibraryScope,
  resolveManagedPath,
  scanFolderContents,
  scanLibrary,
  validateSubfolderPath,
} from "./library"

const DETECTION_BYTES = 64 * 1024
const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 200
const API_BASE = "/api/studios/media"

type BrowserAsset = {
  ref: string
  path: string
  scope: LibraryScope
  user: string | null
  modality: LibraryModality
  mime: string
  bytes: number
  modifiedAt: string
  mediaUrl: string
  downloadUrl: string
}

type BrowserFolder = {
  path: string
  scope: LibraryScope
  user: string | null
  modality: LibraryModality
  name: string
  subfolder: string
}

function browserFolder(
  root: string,
  folder: { folderPath: string; scope: LibraryScope; user?: string; modality: LibraryModality; name: string; subfolder: string },
): BrowserFolder {
  return {
    path: path.relative(root, folder.folderPath).split(path.sep).join("/"),
    scope: folder.scope,
    user: folder.user ?? null,
    modality: folder.modality,
    name: folder.name,
    subfolder: folder.subfolder.split(path.sep).join("/"),
  }
}

class MediaFileError extends Error {
  constructor(
    readonly status: 404 | 416,
    message = "Asset is unavailable",
  ) {
    super(message)
  }
}

function encodeAssetRef(relativePath: string) {
  return Buffer.from(relativePath).toString("base64url")
}

function decodeAssetRef(ref: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(ref)) throw new MediaFileError(404)
  const relativePath = Buffer.from(ref, "base64url").toString("utf8")
  if (!relativePath || encodeAssetRef(relativePath) !== ref) throw new MediaFileError(404)
  return relativePath
}

function browserAsset(
  root: string,
  asset: {
    filePath: string
    scope: LibraryScope
    user?: string
    modality: LibraryModality
    mime: string
    bytes: number
    modifiedAt: string
  },
): BrowserAsset {
  const relativePath = path.relative(root, asset.filePath)
  const ref = encodeAssetRef(relativePath)
  const encodedRef = encodeURIComponent(ref)
  return {
    ref,
    path: relativePath.split(path.sep).join("/"),
    scope: asset.scope,
    user: asset.user ?? null,
    modality: asset.modality,
    mime: asset.mime,
    bytes: asset.bytes,
    modifiedAt: asset.modifiedAt,
    mediaUrl: `${API_BASE}/media/${encodedRef}`,
    downloadUrl: `${API_BASE}/media/${encodedRef}/download`,
  }
}

function parseRange(value: string, size: number) {
  if (!value.startsWith("bytes=") || value.includes(",")) return
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return
  return { start, end: Math.min(end, size - 1) }
}

function integerQuery(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined
}

function safeContentDisposition(filename: string) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_") || "download"
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

async function openValidatedMediaFile(input: {
  root: string
  ref: string
  opener: (filePath: string, flags: number) => Promise<FileHandle>
}) {
  let relativePath: string
  let managed: Awaited<ReturnType<typeof resolveManagedPath>>
  try {
    relativePath = decodeAssetRef(input.ref)
    managed = await resolveManagedPath(input.root, relativePath)
  } catch {
    throw new MediaFileError(404)
  }

  let handle: FileHandle
  try {
    handle = await input.opener(managed.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new MediaFileError(404)
  }

  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size === 0) throw new MediaFileError(404)

    let current: Awaited<ReturnType<typeof resolveManagedPath>>
    try {
      current = await resolveManagedPath(input.root, relativePath)
    } catch {
      throw new MediaFileError(404)
    }
    const currentInfo = await lstat(current.filePath)
    if (current.filePath !== managed.filePath || currentInfo.dev !== info.dev || currentInfo.ino !== info.ino) throw new MediaFileError(404)

    const header = Buffer.alloc(Math.min(info.size, DETECTION_BYTES))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
    if (!detected || modalityFromMime(detected.mime) !== managed.modality) throw new MediaFileError(404)

    return {
      handle,
      asset: {
        ...managed,
        mime: detected.mime,
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      },
    }
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  }
}

function fileHandleStream(handle: FileHandle, start: number, end: number) {
  const reader = Bun.file(handle.fd)
    .slice(start, end + 1)
    .stream()
    .getReader()
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await handle.close().catch(() => {})
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          await close()
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        await close()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        await close()
      }
    },
  })
}

/** Domain router mounted at /api/studios/media */
export function createMediaApi(root: string, options?: { mediaFileOpener?: (filePath: string, flags: number) => Promise<FileHandle> }) {
  const app = new Hono()
  const opener = options?.mediaFileOpener ?? open

  app.onError((error, context) => {
    if (error instanceof MediaFileError) return context.json({ error: error.message }, error.status)
    console.error("media API error", error)
    return context.json({ error: "Internal server error" }, 500)
  })

  app.get("/assets", async (context) => {
    const scope = context.req.query("scope") as LibraryScope | undefined
    const userQuery = context.req.query("user")
    const modality = context.req.query("modality") as LibraryModality | undefined
    const filename = context.req.query("filename")
    const folder = context.req.query("folder") ?? undefined
    const limit = integerQuery(context.req.query("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    const offset = integerQuery(context.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER)
    if (scope && scope !== "personal" && scope !== "shared") return context.json({ error: "Invalid scope" }, 400)
    if (modality && !["image", "audio", "video"].includes(modality)) return context.json({ error: "Invalid modality" }, 400)
    if (scope === "shared" && userQuery !== undefined) return context.json({ error: "A shared Library filter cannot include a user" }, 400)
    if (limit === undefined || offset === undefined) return context.json({ error: "Invalid pagination" }, 400)

    let currentUser: string | undefined
    try {
      currentUser = currentUnixUsername()
    } catch {
      currentUser = undefined
    }
    // Default personal listings to the current OS user (do not scan every account).
    const user = userQuery !== undefined ? userQuery : scope === "shared" ? undefined : currentUser

    if (folder !== undefined) {
      if (!scope) return context.json({ error: "Folder browsing requires a scope" }, 400)
      if (!modality) return context.json({ error: "Folder browsing requires a modality" }, 400)
      if (scope === "personal" && !user) return context.json({ error: "Personal folder browsing requires a user" }, 400)
      let validatedSubfolder: string
      try {
        validatedSubfolder = validateSubfolderPath(folder)
      } catch {
        return context.json({ error: "Invalid folder path" }, 400)
      }
      try {
        const result = await scanFolderContents({
          root,
          scope,
          modality,
          user,
          subfolder: validatedSubfolder || undefined,
          filename,
          limit: limit + 1,
          offset,
        })
        return context.json({
          assets: result.assets.slice(0, limit).map((asset) => browserAsset(root, asset)),
          folders: result.folders.map((folder2) => browserFolder(root, folder2)),
          hasMore: result.assets.length > limit,
          currentUser: currentUser ?? null,
        })
      } catch {
        return context.json({ error: "Invalid Library filters" }, 400)
      }
    }

    try {
      const assets = await scanLibrary({ root, scope, user, modality, filename, limit: limit + 1, offset })
      return context.json({
        assets: assets.slice(0, limit).map((asset) => browserAsset(root, asset)),
        hasMore: assets.length > limit,
        currentUser: currentUser ?? null,
      })
    } catch {
      return context.json({ error: "Invalid Library filters" }, 400)
    }
  })

  app.get("/assets/:ref", async (context) => {
    const opened = await openValidatedMediaFile({ root, ref: context.req.param("ref"), opener })
    try {
      return context.json(browserAsset(root, opened.asset))
    } finally {
      await opened.handle.close()
    }
  })

  app.get("/media/:ref/download", async (context) => {
    const opened = await openValidatedMediaFile({ root, ref: context.req.param("ref"), opener })
    const filename = path.basename(opened.asset.filePath)
    const headers = new Headers({
      "Content-Type": opened.asset.mime,
      "Content-Length": String(opened.asset.bytes),
      "Content-Disposition": safeContentDisposition(filename),
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    })
    return new Response(fileHandleStream(opened.handle, 0, opened.asset.bytes - 1), { headers })
  })

  app.get("/media/:ref", async (context) => {
    const opened = await openValidatedMediaFile({ root, ref: context.req.param("ref"), opener })
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": opened.asset.mime,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    })
    const rangeHeader = context.req.header("range")
    if (!rangeHeader) {
      headers.set("Content-Length", String(opened.asset.bytes))
      return new Response(fileHandleStream(opened.handle, 0, opened.asset.bytes - 1), { headers })
    }
    const range = parseRange(rangeHeader, opened.asset.bytes)
    if (!range) {
      await opened.handle.close()
      headers.set("Content-Range", `bytes */${opened.asset.bytes}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${opened.asset.bytes}`)
    headers.set("Content-Length", String(range.end - range.start + 1))
    return new Response(fileHandleStream(opened.handle, range.start, range.end), { status: 206, headers })
  })

  return app
}
