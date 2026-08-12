import { readFile } from "node:fs/promises"
import { Hono } from "hono"
import {
  buildLogPath,
  buildRecordPath,
  type FwBuildRecord,
  type FwRunRecord,
  listFwProjects,
  readJsonIfPresent,
  resolveFwProject,
  runRecordPath,
  safeFwProjectId,
  uartLogPath,
} from "./workspace"

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
    return await resolveFwProject(root, safeFwProjectId(rawId))
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid Firmware project id") throw new ApiError(400, error.message)
    throw new ApiError(404, "Firmware project not found")
  }
}

async function readTail(filePath: string, maxBytes = 200_000) {
  try {
    const text = await readFile(filePath, "utf8")
    return text.length <= maxBytes ? text : text.slice(text.length - maxBytes)
  } catch {
    return ""
  }
}

export function createFwApi(root: string) {
  const app = new Hono()

  app.onError((error, ctx) => {
    if (error instanceof ApiError) return ctx.json({ error: error.message }, error.status)
    console.error("fw API error", error)
    return ctx.json({ error: "Internal server error" }, 500)
  })

  app.get("/workspace", async (ctx) => {
    const projectId = ctx.req.query("projectId")
    if (!projectId) return ctx.json({ root })
    const project = await requireProject(root, projectId)
    return ctx.json({ root, path: project.path, directory: project.directory })
  })

  app.get("/projects", async (ctx) => {
    const projects = await listFwProjects(root)
    const details = await Promise.all(
      projects.map(async (project) => {
        const run = await readJsonIfPresent<FwRunRecord>(runRecordPath(project.directory))
        const build = await readJsonIfPresent<FwBuildRecord>(buildRecordPath(project.directory))
        return {
          id: project.id,
          path: project.path,
          directory: project.directory,
          chip: project.chip,
          engine: project.engine,
          capabilities: project.capabilities,
          buildOk: build?.ok ?? null,
          runOk: run?.ok ?? null,
        }
      }),
    )
    return ctx.json({ projects: details })
  })

  app.get("/projects/:id", async (ctx) => {
    const project = await requireProject(root, ctx.req.param("id"))
    const build = await readJsonIfPresent<FwBuildRecord>(buildRecordPath(project.directory))
    const run = await readJsonIfPresent<FwRunRecord>(runRecordPath(project.directory))
    return ctx.json({
      id: project.id,
      path: project.path,
      directory: project.directory,
      chip: project.chip,
      engine: project.engine,
      capabilities: project.capabilities,
      name: project.manifest.name,
      build,
      run,
      uart: await readTail(uartLogPath(project.directory)),
      buildLog: await readTail(buildLogPath(project.directory)),
    })
  })

  return app
}
