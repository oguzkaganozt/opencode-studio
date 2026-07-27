import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { createSseResponse } from "../../src/core/sse"
import { type DesignEntry, findDesign, listRenders, type StudioLayout, scanDesigns } from "./library"
import { readArtifactManifest, readDesignManifest } from "./manifest"
import { isInside } from "./studio-path"
import { ensureDesignWatching, onDesignEvent } from "./watcher"

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

export function createCadApi(layout: StudioLayout) {
  const app = new Hono()

  app.onError((error, context) => {
    if (error instanceof StudioError) return context.json({ error: error.message }, error.status as 400 | 404 | 409 | 500)
    console.error("cad API error", error)
    return context.json({ error: "Internal server error" }, 500)
  })

  app.get("/designs", async (context) => {
    const designs = await scanDesigns(layout)
    return context.json({ designs: designs.map((entry) => designEntryDto(layout.root, entry)) })
  })

  app.get("/designs/:id", async (context) => {
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

  app.get("/artifact", async (context) => {
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
    return new Response(Bun.file(resolved), {
      headers: { "Content-Type": mime, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
    })
  })

  app.get("/events", async (context) => {
    ensureDesignWatching(layout)
    return createSseResponse({
      signal: context.req.raw.signal,
      subscribe: (emit) => onDesignEvent(emit),
    })
  })

  app.get("/render", async (context) => {
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
    return new Response(Bun.file(resolved), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
    })
  })

  return app
}
