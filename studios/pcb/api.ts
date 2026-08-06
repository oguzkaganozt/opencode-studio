import { Hono } from "hono"
import { readRegularFileAt } from "../../src/core/paths"
import { safeContentDisposition } from "../../src/core/security"
import { createSseResponse } from "../../src/core/sse"
import { generatePickAndPlace, toCplCsv } from "./assembly"
import { generateBom, toBomCsv } from "./bom"
import { filterCatalogParts, getCatalogPart, loadCatalogParts, partSummary } from "./catalog"
import { manufacturingBlockers, readCircuitJson } from "./circuit-json"
import { circuitReadiness } from "./readiness"
import { ensureWatching, onProjectEvent } from "./watcher"
import { type CircuitProject, discoverProjects, projectDetail, projectSummary, resolveProject } from "./workspace"

function integerQuery(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined
}

class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message)
  }
}

async function requireProject(workspaceRoot: string, id: string): Promise<CircuitProject> {
  const project = await resolveProject(workspaceRoot, id).catch(() => null)
  if (!project) throw new ApiError(404, "Project not found")
  return project
}

async function requireBuiltProject(workspaceRoot: string, id: string): Promise<CircuitProject & { circuitJsonPath: string }> {
  const project = await requireProject(workspaceRoot, id)
  if (!project.circuitJsonPath) throw new ApiError(404, "Circuit JSON not built yet. Run pcb_circuit_build first.")
  return project as CircuitProject & { circuitJsonPath: string }
}

async function serveWorkspaceFile(workspaceRoot: string, filePath: string, contentType: string, downloadName?: string): Promise<Response> {
  let content: Buffer
  try {
    content = await readRegularFileAt(workspaceRoot, filePath)
  } catch {
    throw new ApiError(404, "File not found")
  }
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  }
  if (downloadName) headers["Content-Disposition"] = safeContentDisposition(downloadName)
  return new Response(new Uint8Array(content), { headers })
}

export function createPcbApi(workspaceRoot: string) {
  const app = new Hono()

  app.onError((error, ctx) => {
    if (error instanceof ApiError) return ctx.json({ error: error.message }, error.status)
    console.error("pcb API error", error)
    return ctx.json({ error: "Internal server error" }, 500)
  })

  app.get("/workspace", async (ctx) => {
    const projects = await discoverProjects(workspaceRoot)
    return ctx.json({ root: workspaceRoot, projectCount: projects.length })
  })

  app.get("/projects", async (ctx) => {
    const projects = await discoverProjects(workspaceRoot)
    const limit = integerQuery(ctx.req.query("limit"), 50, 1, 200) ?? 50
    const offset = integerQuery(ctx.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER) ?? 0
    const page = projects.slice(offset, offset + limit)
    return ctx.json({ projects: page.map(projectSummary), total: projects.length, hasMore: offset + limit < projects.length })
  })

  app.get("/projects/:id", async (ctx) => {
    const project = await requireProject(workspaceRoot, ctx.req.param("id"))
    return ctx.json(projectDetail(project))
  })

  app.get("/projects/:id/circuit.json", async (ctx) => {
    const project = await requireBuiltProject(workspaceRoot, ctx.req.param("id"))
    return serveWorkspaceFile(workspaceRoot, project.circuitJsonPath, "application/json")
  })

  app.get("/projects/:id/bom", async (ctx) => {
    const project = await requireBuiltProject(workspaceRoot, ctx.req.param("id"))
    const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
    const catalogParts = await loadCatalogParts(workspaceRoot)
    const bom = generateBom(json, catalogParts)
    return ctx.json({
      projectId: ctx.req.param("id"),
      name: project.name,
      fabricationReady: project.fabricationReady,
      assemblyReady: project.assemblyReady,
      ...bom,
    })
  })

  app.get("/projects/:id/bom.csv", async (ctx) => {
    const project = await requireBuiltProject(workspaceRoot, ctx.req.param("id"))
    const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
    const catalogParts = await loadCatalogParts(workspaceRoot)
    const bom = generateBom(json, catalogParts)
    const csv = toBomCsv(bom.entries)
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": safeContentDisposition(`${project.name}-bom.csv`),
        "Cache-Control": "no-cache",
      },
    })
  })

  app.get("/projects/:id/assembly.csv", async (ctx) => {
    const project = await requireBuiltProject(workspaceRoot, ctx.req.param("id"))
    const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
    const readiness = circuitReadiness(json)
    if (readiness.assemblyBlockers.length > 0) {
      return ctx.json(
        {
          error: "Assembly export blocked",
          fabricationReady: readiness.fabricationReady,
          assemblyReady: false,
          assemblyBlockers: readiness.assemblyBlockers,
        },
        409,
      )
    }
    const result = generatePickAndPlace(json)
    const csv = toCplCsv(result.entries)
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": safeContentDisposition(`${project.name}-pick-and-place.csv`),
        "Cache-Control": "no-cache",
      },
    })
  })

  app.get("/projects/:id/schematic.svg", async (ctx) => {
    const project = await requireProject(workspaceRoot, ctx.req.param("id"))
    if (!project.schematicSvgPath) return ctx.json({ error: "Schematic SVG not built yet. Run pcb_circuit_export first." }, 404)
    return serveWorkspaceFile(workspaceRoot, project.schematicSvgPath, "image/svg+xml")
  })

  app.get("/projects/:id/pcb.svg", async (ctx) => {
    const project = await requireProject(workspaceRoot, ctx.req.param("id"))
    if (!project.pcbSvgPath) return ctx.json({ error: "PCB SVG not built yet. Run pcb_circuit_export first." }, 404)
    return serveWorkspaceFile(workspaceRoot, project.pcbSvgPath, "image/svg+xml")
  })

  app.get("/projects/:id/gerbers.zip", async (ctx) => {
    const project = await requireProject(workspaceRoot, ctx.req.param("id"))
    if (!project.gerbersZipPath) return ctx.json({ error: "Gerbers not exported yet. Run pcb_circuit_export with format 'gerber'." }, 404)
    if (!project.circuitJsonPath) {
      return ctx.json({ error: "Circuit JSON missing; rebuild before downloading Gerbers." }, 404)
    }
    const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
    const blockers = manufacturingBlockers(json)
    if (blockers.length > 0) {
      return ctx.json(
        {
          error: "Gerber download blocked — design is not fabrication-ready",
          fabricationReady: false,
          manufacturingBlockers: blockers,
        },
        409,
      )
    }
    return serveWorkspaceFile(workspaceRoot, project.gerbersZipPath, "application/zip", `${project.name}-gerbers.zip`)
  })

  app.get("/events", async (ctx) => {
    await ensureWatching(workspaceRoot)
    return createSseResponse({
      signal: ctx.req.raw.signal,
      subscribe: (emit) => onProjectEvent(emit),
    })
  })

  app.get("/catalog", async (ctx) => {
    const parts = await loadCatalogParts(workspaceRoot)
    const filtered = filterCatalogParts(parts, ctx.req.query("q"))
    return ctx.json({ parts: filtered.map(partSummary), total: filtered.length })
  })

  app.get("/catalog/:mpn", async (ctx) => {
    const part = await getCatalogPart(workspaceRoot, ctx.req.param("mpn"))
    if (!part) return ctx.json({ error: "Part not found" }, 404)
    return ctx.json({ part })
  })

  return app
}
