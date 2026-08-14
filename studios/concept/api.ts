import { readFile } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { StudioError } from "../../src/core/errors"
import { resolveContainedPath } from "../../src/core/paths"
import { createSseResponse } from "../../src/core/sse"
import { safeConceptId } from "./schema"
import { ensureConceptWatching, onConceptEvent } from "./watcher"
import { listConcepts, readBriefIfPresent, readReviewIfPresent, resolveConcept } from "./workspace"

class ApiError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message)
  }
}

async function requireConcept(root: string, rawId: string) {
  try {
    return await resolveConcept(root, safeConceptId(rawId))
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid concept id") throw new ApiError(400, error.message)
    throw new ApiError(404, "Concept not found")
  }
}

export function createConceptApi(root: string) {
  const app = new Hono()

  app.onError((error, ctx) => {
    if (error instanceof ApiError) return ctx.json({ error: error.message }, error.status)
    console.error("concept API error", error)
    return ctx.json({ error: "Internal server error" }, 500)
  })

  app.get("/workspace", async (ctx) => {
    const conceptId = ctx.req.query("conceptId")
    if (!conceptId) return ctx.json({ root })
    const entry = await requireConcept(root, conceptId)
    return ctx.json({ root, path: entry.id, directory: entry.directory })
  })

  app.get("/concepts", async (ctx) => {
    const entries = await listConcepts(root)
    return ctx.json({
      concepts: entries.map((entry) => {
        const thumb =
          entry.concept.moodboards.find((item) => item.direction_id === entry.concept.chosen_direction) ?? entry.concept.moodboards[0]
        return {
          id: entry.id,
          directory: entry.directory,
          status: entry.concept.status,
          one_liner: entry.concept.intent?.one_liner ?? null,
          product_type: entry.concept.intent?.product_type ?? null,
          thumb: thumb?.path ?? null,
        }
      }),
    })
  })

  app.get("/concepts/:id", async (ctx) => {
    const entry = await requireConcept(root, ctx.req.param("id"))
    return ctx.json({
      id: entry.id,
      directory: entry.directory,
      concept: entry.concept,
      review: await readReviewIfPresent(entry.directory),
      brief: await readBriefIfPresent(entry.directory),
    })
  })

  app.get("/concepts/:id/moodboards/:file", async (ctx) => {
    const entry = await requireConcept(root, ctx.req.param("id"))
    const file = ctx.req.param("file")
    const candidate = path.resolve(moodboardFile(entry.directory, file))
    try {
      const resolved = await resolveContainedPath(path.join(entry.directory, "moodboards"), candidate, {
        kind: "file",
        rejectSymlink: false,
        realpathRoot: true,
      })
      const bytes = await readFile(resolved.absolute)
      return new Response(bytes, { headers: { "content-type": contentType(file) } })
    } catch (error) {
      if (error instanceof StudioError) throw new ApiError(error.code === "path_escape" ? 400 : 404, "Moodboard not found")
      throw error
    }
  })

  app.get("/events", async (ctx) => {
    await ensureConceptWatching(root)
    return createSseResponse({
      signal: ctx.req.raw.signal,
      subscribe: (emit) => onConceptEvent(emit),
    })
  })

  return app
}

function moodboardFile(directory: string, file: string) {
  if (!file || file.includes("/") || file.includes("\\") || file.includes("\0")) throw new ApiError(400, "Invalid moodboard file")
  return path.join(directory, "moodboards", file)
}

function contentType(file: string) {
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg"
  if (file.endsWith(".webp")) return "image/webp"
  return "image/png"
}
