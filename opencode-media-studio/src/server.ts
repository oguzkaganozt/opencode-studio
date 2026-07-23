import { constants } from "node:fs"
import { type FileHandle, lstat, open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import { Hono } from "hono"
import { modalityFromMime } from "./assets"
import {
  type LibraryModality,
  type LibraryScope,
  resolveManagedPath,
  scanFolderContents,
  scanLibrary,
  validateSubfolderPath,
} from "./library"
import { isInside } from "./studio-path"
import { staticVersionInfo, type VersionInfo } from "./version"

const DETECTION_BYTES = 64 * 1024
const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 200

const CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; child-src 'self' blob:"

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

export function allowedHost(hostHeader: string | undefined, hostname: string, port: number) {
  if (!hostHeader || /[\0\r\n\s]/.test(hostHeader)) return false
  // Wildcard bind is for reverse-proxy / Cloudflare Tunnel deployments. The
  // bind address is not a valid browser Host, so accept any present Host and
  // rely on network-layer access control (firewall + Access).
  if (hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]") return true
  const allowed = new Set([`${hostname}:${port}`, hostname, `127.0.0.1:${port}`, "127.0.0.1", `localhost:${port}`, "localhost"])
  if (hostname === "127.0.0.1") {
    allowed.add(`[::1]:${port}`)
    allowed.add("[::1]")
    allowed.add(`::1:${port}`)
    allowed.add("::1")
  }
  return allowed.has(hostHeader)
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

function fileIdentity(info: { dev: number; ino: number }) {
  return { dev: info.dev, ino: info.ino }
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
    mediaUrl: `/api/media/${encodedRef}`,
    downloadUrl: `/api/media/${encodedRef}/download`,
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
      relativePath,
      identity: fileIdentity(info),
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

export type MediaStudioAppInput = {
  root: string
  hostname: string
  port: number
  studioId: string
  packageVersion: string
  contractVersion: string
  uiDirectory?: string
  mediaFileOpener?: (filePath: string, flags: number) => Promise<FileHandle>
  versionProvider?: () => Promise<VersionInfo>
}

export function createMediaStudioApp(input: MediaStudioAppInput) {
  const app = new Hono()

  app.use("*", async (context, next) => {
    const host = context.req.header("host")
    if (!allowedHost(host, input.hostname, input.port)) {
      return context.json({ error: "Host header rejected" }, 400)
    }
    await next()
    context.header("X-Content-Type-Options", "nosniff")
    context.header("Content-Security-Policy", CSP)
  })

  app.onError((error, context) => {
    if (error instanceof MediaFileError) return context.json({ error: error.message }, error.status)
    console.error("opencode-media-studio API error", error)
    return context.json({ error: "Internal server error" }, 500)
  })

  if (!input.uiDirectory) app.get("/", (context) => context.json({ name: "opencode-media-studio", status: "ok" }))
  app.get("/api/health", (context) => context.json({ status: "ok" }))
  app.get("/api/version", async (context) => context.json(input.versionProvider ? await input.versionProvider() : staticVersionInfo()))
  app.get("/api/studio", (context) =>
    context.json({
      id: input.studioId,
      packageVersion: input.packageVersion,
      contractVersion: input.contractVersion,
    }),
  )

  app.get("/api/assets", async (context) => {
    const scope = context.req.query("scope") as LibraryScope | undefined
    const user = context.req.query("user")
    const modality = context.req.query("modality") as LibraryModality | undefined
    const filename = context.req.query("filename")
    const folder = context.req.query("folder") ?? undefined
    const limit = integerQuery(context.req.query("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    const offset = integerQuery(context.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER)
    if (scope && scope !== "personal" && scope !== "shared") return context.json({ error: "Invalid scope" }, 400)
    if (modality && !["image", "audio", "video"].includes(modality)) return context.json({ error: "Invalid modality" }, 400)
    if (scope === "shared" && user !== undefined) return context.json({ error: "A shared Library filter cannot include a user" }, 400)
    if (limit === undefined || offset === undefined) return context.json({ error: "Invalid pagination" }, 400)

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
          root: input.root,
          scope,
          modality,
          user,
          subfolder: validatedSubfolder || undefined,
          filename,
          limit: limit + 1,
          offset,
        })
        return context.json({
          assets: result.assets.slice(0, limit).map((asset) => browserAsset(input.root, asset)),
          folders: result.folders.map((folder2) => browserFolder(input.root, folder2)),
          hasMore: result.assets.length > limit,
        })
      } catch {
        return context.json({ error: "Invalid Library filters" }, 400)
      }
    }

    try {
      const assets = await scanLibrary({ root: input.root, scope, user, modality, filename, limit: limit + 1, offset })
      return context.json({
        assets: assets.slice(0, limit).map((asset) => browserAsset(input.root, asset)),
        hasMore: assets.length > limit,
      })
    } catch {
      return context.json({ error: "Invalid Library filters" }, 400)
    }
  })

  app.get("/api/assets/:ref", async (context) => {
    const opened = await openValidatedMediaFile({
      root: input.root,
      ref: context.req.param("ref"),
      opener: input.mediaFileOpener ?? open,
    })
    try {
      return context.json(browserAsset(input.root, opened.asset))
    } finally {
      await opened.handle.close()
    }
  })

  app.get("/api/media/:ref/download", async (context) => {
    const opened = await openValidatedMediaFile({
      root: input.root,
      ref: context.req.param("ref"),
      opener: input.mediaFileOpener ?? open,
    })
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

  app.get("/api/media/:ref", async (context) => {
    const opened = await openValidatedMediaFile({
      root: input.root,
      ref: context.req.param("ref"),
      opener: input.mediaFileOpener ?? open,
    })
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

  if (input.uiDirectory) {
    const uiRoot = path.resolve(input.uiDirectory)
    const canonicalUiRoot = realpath(uiRoot).catch(() => uiRoot)
    app.all("/api/*", (context) => context.json({ error: "Not found" }, 404))
    app.get("*", async (context) => {
      let requestPath: string
      try {
        requestPath = decodeURIComponent(context.req.path)
      } catch {
        return context.json({ error: "Invalid path" }, 400)
      }
      const candidate = path.resolve(uiRoot, `.${requestPath}`)
      if (requestPath !== "/" && isInside(uiRoot, candidate)) {
        try {
          const canonicalCandidate = await realpath(candidate)
          const candidateStat = await stat(canonicalCandidate)
          if (candidateStat.isFile() && isInside(await canonicalUiRoot, canonicalCandidate)) {
            const file = Bun.file(canonicalCandidate)
            return new Response(file, {
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "Cache-Control": requestPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
              },
            })
          }
        } catch {
          // Missing paths are handled by the SPA fallback.
        }
      }
      const index = Bun.file(path.join(uiRoot, "index.html"))
      if (!(await index.exists())) return context.json({ error: "Companion UI build not found; run bun run build:ui" }, 503)
      return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } })
    })
  }

  return app
}
