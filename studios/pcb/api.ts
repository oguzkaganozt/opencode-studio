import { Hono } from "hono"
import { resolveContainedPath } from "../../src/core/paths"
import { safeContentDisposition } from "../../src/core/security"
import { createSseResponse } from "../../src/core/sse"
import { toCplCsv } from "./assembly"
import { generateBom, toBomCsv } from "./bom"
import { filterCatalogParts, getCatalogPart, loadCatalogParts, partDetail, partSummary, upsertCatalogPart } from "./catalog"
import { manufacturingBlockers, readCircuitJson } from "./circuit-json"
import { circuitReadiness } from "./readiness"
import { extractAnalogSimulationDiagnostics, extractAnalogSimulationExperiments, SIMULATION_ESTIMATE_CAVEAT } from "./tsci"
import { ensureWatching, onProjectEvent } from "./watcher"
import {
  type CircuitProject,
  discoverProjectDescriptors,
  loadProjects,
  projectDetail,
  projectSummary,
  resolveProject,
  resolveProjectLocation,
} from "./workspace"

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
  if (project.artifactError) throw new ApiError(409, project.artifactError)
  if (!project.circuitJsonPath) throw new ApiError(404, "Circuit JSON not built yet. Run pcb_circuit_build first.")
  return project as CircuitProject & { circuitJsonPath: string }
}

async function loadProjectBom(workspaceRoot: string, id: string) {
  const project = await requireBuiltProject(workspaceRoot, id)
  const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
  const catalogParts = await loadCatalogParts(workspaceRoot)
  const bom = generateBom(json, catalogParts)
  return { project, bom }
}

async function serveProjectSvg(workspaceRoot: string, id: string, pathKey: "schematicSvgPath" | "pcbSvgPath", missingMessage: string) {
  const project = await requireProject(workspaceRoot, id)
  if (project.artifactError)
    return new Response(JSON.stringify({ error: project.artifactError }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })
  const svgPath = project[pathKey]
  if (!svgPath)
    return new Response(JSON.stringify({ error: missingMessage }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  return serveWorkspaceFile(workspaceRoot, svgPath, "image/svg+xml")
}

async function serveWorkspaceFile(workspaceRoot: string, filePath: string, contentType: string, downloadName?: string): Promise<Response> {
  let absolute: string
  try {
    ;({ absolute } = await resolveContainedPath(workspaceRoot, filePath, { kind: "file", rejectSymlink: true }))
  } catch {
    throw new ApiError(404, "File not found")
  }
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  }
  if (downloadName) headers["Content-Disposition"] = safeContentDisposition(downloadName)
  return new Response(Bun.file(absolute), { headers })
}

export function createPcbApi(workspaceRoot: string) {
  const app = new Hono()

  app.onError((error, ctx) => {
    if (error instanceof ApiError) return ctx.json({ error: error.message }, error.status)
    console.error("pcb API error", error)
    return ctx.json({ error: "Internal server error" }, 500)
  })

  app.get("/workspace", async (ctx) => {
    const projectId = ctx.req.query("projectId")
    if (!projectId) return ctx.json({ root: workspaceRoot })
    try {
      const location = resolveProjectLocation(workspaceRoot, projectId)
      return ctx.json({ root: workspaceRoot, path: location.relativePath, directory: location.absolutePath })
    } catch {
      throw new ApiError(400, "Invalid project ID")
    }
  })

  app.get("/projects", async (ctx) => {
    const descriptors = await discoverProjectDescriptors(workspaceRoot)
    if (ctx.req.query("all") === "1") {
      const projects: CircuitProject[] = []
      for (let offset = 0; offset < descriptors.length; offset += 50) {
        projects.push(...(await loadProjects(descriptors.slice(offset, offset + 50))))
      }
      return ctx.json({ projects: projects.map(projectSummary), total: descriptors.length, hasMore: false })
    }
    const limit = integerQuery(ctx.req.query("limit"), 50, 1, 200) ?? 50
    const offset = integerQuery(ctx.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER) ?? 0
    const page = await loadProjects(descriptors.slice(offset, offset + limit))
    return ctx.json({ projects: page.map(projectSummary), total: descriptors.length, hasMore: offset + limit < descriptors.length })
  })

  app.get("/projects/:id", async (ctx) => {
    const project = await requireProject(workspaceRoot, ctx.req.param("id"))
    return ctx.json(projectDetail(project))
  })

  app.get("/projects/:id/circuit.json", async (ctx) => {
    const project = await requireBuiltProject(workspaceRoot, ctx.req.param("id"))
    return serveWorkspaceFile(workspaceRoot, project.circuitJsonPath, "application/json")
  })

  app.get("/projects/:id/simulation", async (ctx) => {
    const project = await requireBuiltProject(workspaceRoot, ctx.req.param("id"))
    const maxPoints = integerQuery(ctx.req.query("maxPoints"), 500, 2, 2000)
    if (maxPoints === undefined) throw new ApiError(400, "maxPoints must be an integer between 2 and 2000")
    const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
    const experiments = extractAnalogSimulationExperiments(json, maxPoints)
    const diagnostics = extractAnalogSimulationDiagnostics(json)
    if (experiments.length === 0 && diagnostics.length === 0) {
      return ctx.json({ error: "No simulation results. Add <analogsimulation> and named probes, then run pcb_sim_run." }, 404)
    }
    return ctx.json({
      projectId: ctx.req.param("id"),
      name: project.name,
      simulationSuccess: experiments.length > 0 && diagnostics.length === 0,
      experiments,
      diagnostics,
      caveat: SIMULATION_ESTIMATE_CAVEAT,
    })
  })

  app.get("/projects/:id/bom", async (ctx) => {
    const { project, bom } = await loadProjectBom(workspaceRoot, ctx.req.param("id"))
    return ctx.json({
      projectId: ctx.req.param("id"),
      name: project.name,
      fabricationReady: project.fabricationReady,
      assemblyReady: project.assemblyReady,
      ...bom,
    })
  })

  app.get("/projects/:id/bom.csv", async (ctx) => {
    const { project, bom } = await loadProjectBom(workspaceRoot, ctx.req.param("id"))
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
    const result = readiness.placement
    const csv = toCplCsv(result.entries)
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": safeContentDisposition(`${project.name}-pick-and-place.csv`),
        "Cache-Control": "no-cache",
      },
    })
  })

  app.get("/projects/:id/schematic.svg", async (ctx) =>
    serveProjectSvg(workspaceRoot, ctx.req.param("id"), "schematicSvgPath", "Schematic SVG not built yet. Run pcb_circuit_export first."),
  )

  app.get("/projects/:id/pcb.svg", async (ctx) =>
    serveProjectSvg(workspaceRoot, ctx.req.param("id"), "pcbSvgPath", "PCB SVG not built yet. Run pcb_circuit_export first."),
  )

  app.get("/projects/:id/gerbers.zip", async (ctx) => {
    const project = await requireProject(workspaceRoot, ctx.req.param("id"))
    if (project.artifactError) return ctx.json({ error: project.artifactError }, 409)
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
    return ctx.json({ part: partDetail(part) })
  })

  app.put("/catalog/:mpn", async (ctx) => {
    const mpnParam = ctx.req.param("mpn")
    const body = (await ctx.req.json().catch(() => null)) as {
      manufacturer?: string | null
      description?: string | null
      datasheet?: string | null
      category?: string | null
      replace?: boolean
    } | null
    if (!body || typeof body !== "object") throw new ApiError(400, "JSON body required")
    const result = await upsertCatalogPart(workspaceRoot, {
      mpn: mpnParam,
      manufacturer: body.manufacturer,
      description: body.description,
      datasheet: body.datasheet,
      category: body.category,
      replace: body.replace === true,
    })
    if (!result.ok) {
      const status = result.code === "invalid_mpn" || result.code === "invalid_datasheet" ? 400 : result.code === "catalog_full" ? 409 : 500
      throw new ApiError(status, result.error)
    }
    return ctx.json({ created: result.created, path: result.path, part: partDetail(result.part) })
  })

  return app
}
