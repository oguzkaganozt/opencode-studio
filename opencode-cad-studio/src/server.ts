import { lstat, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { type DesignEntry, findDesign, listRenders, type StudioLayout, scanDesigns } from "./library"
import { readArtifactManifest, readDesignManifest } from "./manifest"
import { isInside } from "./studio-path"
import { staticVersionInfo, type VersionInfo } from "./version"

const CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:"

class StudioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function safeDesignId(id: string) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new StudioError(400, "Invalid design id")
  return id
}

function designEntryDto(root: string, entry: DesignEntry) {
  return {
    id: entry.id,
    directory: path.relative(root, entry.directory).split(path.sep).join("/"),
    buildStatus: entry.buildStatus,
    partCount: entry.partCount,
    revision: entry.revision,
    renderRevision: entry.renderRevision,
  }
}

function allowedHost(hostHeader: string | undefined, hostname: string, port: number) {
  if (!hostHeader) return false
  const allowed = new Set([`${hostname}:${port}`, hostname, `127.0.0.1:${port}`, "127.0.0.1", `localhost:${port}`, "localhost"])
  if (hostname === "127.0.0.1") {
    allowed.add(`[::1]:${port}`)
    allowed.add("[::1]")
    allowed.add(`::1:${port}`)
    allowed.add("::1")
  }
  return allowed.has(hostHeader)
}

function securityHeaders(): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": CSP,
  }
}

export type StudioAppInput = {
  layout: StudioLayout
  hostname: string
  port: number
  studioId: string
  packageVersion: string
  contractVersion: string
  uiDirectory?: string
  versionProvider?: () => Promise<VersionInfo>
}

export function createStudioApp(input: StudioAppInput) {
  const app = new Hono()
  const layout = input.layout

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
    if (error instanceof StudioError) return context.json({ error: error.message }, error.status as 400 | 404 | 409 | 500)
    console.error("opencode-cad-studio API error", error)
    return context.json({ error: "Internal server error" }, 500)
  })

  app.get("/api/health", (context) => context.json({ status: "ok" }))

  app.get("/api/studio", (context) =>
    context.json({
      id: input.studioId,
      packageVersion: input.packageVersion,
      contractVersion: input.contractVersion,
    }),
  )

  app.get("/api/version", async (context) => context.json(input.versionProvider ? await input.versionProvider() : staticVersionInfo()))

  app.get("/api/designs", async (context) => {
    const designs = await scanDesigns(layout)
    return context.json({ designs: designs.map((entry) => designEntryDto(layout.root, entry)) })
  })

  app.get("/api/designs/:id", async (context) => {
    const id = safeDesignId(context.req.param("id"))
    const entry = await findDesign(layout, id)
    if (!entry) return context.json({ error: "Design not found" }, 404)
    const design = await readDesignManifest(entry.directory, entry.id)
    const artifact = await readArtifactManifest(entry.directory, entry.id)
    const renders = await listRenders(entry.directory)
    return context.json({
      ...designEntryDto(layout.root, entry),
      design: {
        schema: design.schema,
        id: design.id,
        params: design.params,
        parts: design.parts,
      },
      artifact: artifact ?? null,
      renders,
    })
  })

  app.get("/api/artifact", async (context) => {
    const designId = context.req.query("design")
    const file = context.req.query("file")
    if (!designId || !file) return context.json({ error: "design and file parameters are required" }, 400)
    safeDesignId(designId)

    const entry = await findDesign(layout, designId)
    if (!entry) return context.json({ error: "Design not found" }, 404)

    const artifact = await readArtifactManifest(entry.directory, entry.id)
    if (!artifact) return context.json({ error: "Design has no built artifacts; run design_build first" }, 404)

    const allowedPart = artifact.parts.find((part) => part.files.glb === file || part.files.step === file || part.files.stl === file)
    if (!allowedPart) return context.json({ error: "Artifact not listed in manifest" }, 404)

    const candidate = path.resolve(entry.directory, file)
    if (!isInside(entry.directory, candidate)) return context.json({ error: "Artifact escapes design directory" }, 400)

    let resolved: string
    try {
      resolved = await realpath(candidate)
    } catch {
      return context.json({ error: "Artifact file not found" }, 404)
    }
    if (!isInside(await realpath(entry.directory), resolved)) {
      return context.json({ error: "Artifact resolves outside design directory" }, 400)
    }
    const info = await lstat(resolved)
    if (!info.isFile()) return context.json({ error: "Artifact is not a regular file" }, 404)

    const extension = path.extname(resolved).toLowerCase()
    const mime = extension === ".glb" ? "model/gltf-binary" : extension === ".step" ? "application/step" : "model/stl"
    const file2 = Bun.file(resolved)
    return new Response(file2, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-cache",
        ...securityHeaders(),
      },
    })
  })

  app.get("/api/render", async (context) => {
    const designId = context.req.query("design")
    const file = context.req.query("file")
    if (!designId || !file) return context.json({ error: "design and file parameters are required" }, 400)
    safeDesignId(designId)
    if (!/^[a-z0-9][a-z0-9_-]*\.png$/.test(file)) return context.json({ error: "Render file must match ^[a-z0-9][a-z0-9_-]*\\.png$" }, 400)

    const entry = await findDesign(layout, designId)
    if (!entry) return context.json({ error: "Design not found" }, 404)

    const rendersDir = path.join(entry.directory, "renders")
    const candidate = path.resolve(rendersDir, file)
    if (!isInside(rendersDir, candidate)) return context.json({ error: "Render escapes renders directory" }, 400)

    let resolved: string
    try {
      resolved = await realpath(candidate)
    } catch {
      return context.json({ error: "Render file not found" }, 404)
    }
    const canonicalRenders = await realpath(rendersDir).catch(() => null)
    if (!canonicalRenders || !isInside(canonicalRenders, resolved)) {
      return context.json({ error: "Render resolves outside renders directory" }, 400)
    }
    const info = await lstat(resolved)
    if (!info.isFile()) return context.json({ error: "Render is not a regular file" }, 404)

    const file2 = Bun.file(resolved)
    return new Response(file2, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
        ...securityHeaders(),
      },
    })
  })

  if (input.uiDirectory) {
    const uiRoot = path.resolve(input.uiDirectory)
    const canonicalUiRoot = realpath(uiRoot).catch(() => null)
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
          const canonicalRoot = await canonicalUiRoot
          if (canonicalRoot && candidateStat.isFile() && isInside(canonicalRoot, canonicalCandidate)) {
            const file = Bun.file(canonicalCandidate)
            return new Response(file, {
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "Cache-Control": requestPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
                ...securityHeaders(),
              },
            })
          }
        } catch {
          // Missing paths fall through to the SPA fallback.
        }
      }
      const index = Bun.file(path.join(uiRoot, "index.html"))
      if (!(await index.exists())) {
        return context.json({ error: "Companion UI build not found; run bun run build:ui" }, 503)
      }
      return new Response(index, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          ...securityHeaders(),
        },
      })
    })
  }

  return app
}
