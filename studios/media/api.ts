import { Hono } from "hono"
import { createFilesApi } from "../../src/platform/media/files-api"
import { listMediaProjects, resolveMediaProject, safeMediaProjectId } from "./workspace"

class ApiError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message)
  }
}

async function requireProject(root: string, rawId: string) {
  try {
    return await resolveMediaProject(root, safeMediaProjectId(rawId))
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid Media project id") throw new ApiError(400, error.message)
    throw new ApiError(404, "Media project not found")
  }
}

export function createMediaApi(root: string) {
  const app = new Hono()
  const fileApis = new Map<string, Promise<Awaited<ReturnType<typeof createFilesApi>>>>()

  app.onError((error, ctx) => {
    if (error instanceof ApiError) return ctx.json({ error: error.message }, error.status)
    console.error("media API error", error)
    return ctx.json({ error: "Internal server error" }, 500)
  })

  app.get("/workspace", async (ctx) => {
    const projectId = ctx.req.query("projectId")
    if (!projectId) return ctx.json({ root })
    const project = await requireProject(root, projectId)
    return ctx.json({ root, path: project.path, directory: project.directory })
  })

  app.get("/projects", async (ctx) => {
    const projects = await listMediaProjects(root)
    return ctx.json({ projects })
  })

  app.get("/projects/:id", async (ctx) => ctx.json(await requireProject(root, ctx.req.param("id"))))

  const dispatchFiles = async (ctx: { req: { url: string; raw: Request; param: (name: string) => string } }) => {
    const project = await requireProject(root, ctx.req.param("id"))
    let files = fileApis.get(project.directory)
    if (!files) {
      const publicBasePath = `/api/studios/media/projects/${encodeURIComponent(project.id)}/files`
      files = createFilesApi(project.directory, { publicBasePath })
      fileApis.set(project.directory, files)
    }
    const url = new URL(ctx.req.url)
    const marker = `/projects/${encodeURIComponent(project.id)}/files`
    const markerIndex = url.pathname.indexOf(marker)
    const suffix = (markerIndex >= 0 ? url.pathname.slice(markerIndex + marker.length) : "") || "/"
    return (await files).request(suffix + url.search, ctx.req.raw)
  }
  app.all("/projects/:id/files", dispatchFiles)
  app.all("/projects/:id/files/*", dispatchFiles)

  return app
}
