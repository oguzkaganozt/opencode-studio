import path from "node:path"
import { Hono } from "hono"
import { StudioError } from "../../../src/core/errors"
import { resolveContainedPath } from "../../../src/core/paths"
import { createSseResponse } from "../../../src/core/sse"
import { type DesignEntry, findDesign, listRenders, RENDER_FILE_PATTERN, type StudioLayout, scanDesigns } from "./library"
import { ID_PATTERN, readArtifactManifest, readDesignManifest } from "./manifest"
import { ensureDesignWatching, onDesignEvent } from "./watcher"

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const ARTIFACT_MIME: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".step": "application/step",
  ".stl": "model/stl",
  ".json": "application/json",
}

function safeDesignId(id: string) {
  if (!ID_PATTERN.test(id)) throw new ApiError(400, "Invalid design id")
  return id
}

async function resolveRegularFileInside(root: string, candidate: string, escapeMessage: string, notFoundMessage: string) {
  try {
    const { absolute } = await resolveContainedPath(root, candidate, {
      kind: "file",
      rejectSymlink: false,
      realpathRoot: true,
    })
    return absolute
  } catch (error) {
    if (error instanceof StudioError) {
      if (error.code === "path_escape" || error.code === "path_resolves_outside") throw new ApiError(400, escapeMessage)
      throw new ApiError(404, notFoundMessage)
    }
    throw error
  }
}

function designEntryDto(root: string, entry: DesignEntry) {
  return {
    id: entry.id,
    directory: path.relative(root, entry.directory).split(path.sep).join("/"),
    absoluteDirectory: entry.directory,
    buildStatus: entry.buildStatus,
    partCount: entry.partCount,
    revision: entry.revision,
    renderRevision: entry.renderRevision,
  }
}

export function createCadApi(layout: StudioLayout) {
  const app = new Hono()

  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json({ error: error.message }, error.status as 400 | 404 | 409 | 500)
    console.error("cad API error", error)
    return context.json({ error: "Internal server error" }, 500)
  })

  app.get("/workspace", (context) => {
    const designId = context.req.query("designId")
    if (!designId) return context.json({ root: layout.root })
    const id = safeDesignId(designId)
    return context.json({ root: layout.root, path: id, directory: path.resolve(layout.root, id) })
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
    if (!artifact) return context.json({ error: "Design has no built artifacts; run cad_design_build first" }, 404)
    const allowedPart = artifact.parts.find(
      (part) => part.files.glb === file || part.files.step === file || part.files.stl === file || part.files.topo === file,
    )
    if (!allowedPart) return context.json({ error: "Artifact not listed in manifest" }, 404)
    const candidate = path.resolve(entry.directory, file)
    const resolved = await resolveRegularFileInside(
      entry.directory,
      candidate,
      "Artifact escapes design directory",
      "Artifact file not found",
    )
    const extension = path.extname(resolved).toLowerCase()
    const mime = ARTIFACT_MIME[extension] ?? "application/octet-stream"
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
    if (!RENDER_FILE_PATTERN.test(file)) return context.json({ error: "Render file must match ^[a-z0-9][a-z0-9_-]*\\.png$" }, 400)
    const entry = await findDesign(layout, designId)
    if (!entry) return context.json({ error: "Design not found" }, 404)
    const rendersDir = path.join(entry.directory, "renders")
    const candidate = path.resolve(rendersDir, file)
    const resolved = await resolveRegularFileInside(rendersDir, candidate, "Render escapes renders directory", "Render file not found")
    return new Response(Bun.file(resolved), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
    })
  })

  return app
}
