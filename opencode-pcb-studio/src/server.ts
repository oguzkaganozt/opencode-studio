import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { generatePickAndPlace, toCplCsv } from "./assembly"
import { bomIdentityBlocker, generateBom, toBomCsv } from "./bom"
import { getCatalogPart, loadCatalogParts, partSummary } from "./catalog"
import { manufacturingBlockers, readCircuitJson } from "./circuit-json"
import { isInside } from "./studio-path"
import { ensureWatching, onProjectEvent } from "./watcher"
import { discoverProjects, projectDetail, projectSummary, resolveProject } from "./workspace"

// unsafe-inline: Manifold preload injects a type=module script (same pattern as @tscircuit/3d-viewer)
// unsafe-eval: Emscripten Manifold/OCCT glue evaluates JS strings
// kicad-mod-cache: remote STEP part models (domain Resources allowlist)
// cdn.jsdelivr.net: manifold-3d + occt-import-js used by the 3D viewer
const CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: data: https://kicad-mod-cache.tscircuit.com https://cdn.jsdelivr.net; worker-src 'self' blob:; child-src 'self' blob:"

function integerQuery(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined
}

class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message)
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

async function serveWorkspaceFile(workspaceRoot: string, filePath: string, contentType: string, downloadName?: string): Promise<Response> {
  // Confinement: filePath must be inside workspaceRoot
  const resolved = path.resolve(filePath)
  if (!isInside(workspaceRoot, resolved)) throw new ApiError(404, "File not found")

  let content: Buffer
  try {
    content = await readFile(resolved)
  } catch {
    throw new ApiError(404, "File not found")
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  }
  if (downloadName) headers["Content-Disposition"] = `attachment; filename="${downloadName}"`

  return new Response(new Uint8Array(content), { headers })
}

export type PcbStudioAppInput = {
  workspaceRoot: string
  hostname: string
  port: number
  studioId: string
  packageVersion: string
  contractVersion: string
  uiDirectory?: string
}

export function createPcbStudioApp(input: PcbStudioAppInput) {
  const { workspaceRoot } = input
  const app = new Hono()

  app.use("*", async (ctx, next) => {
    const host = ctx.req.header("host")
    if (!allowedHost(host, input.hostname, input.port)) {
      return ctx.json({ error: "Host header rejected" }, 400)
    }
    await next()
    ctx.header("X-Content-Type-Options", "nosniff")
    ctx.header("Content-Security-Policy", CSP)
  })

  app.onError((error, ctx) => {
    if (error instanceof ApiError) return ctx.json({ error: error.message }, error.status)
    console.error("opencode-pcb-studio API error", error)
    return ctx.json({ error: "Internal server error" }, 500)
  })

  // ── Health / identity ────────────────────────────────────────────────────────
  if (!input.uiDirectory) app.get("/", (ctx) => ctx.json({ name: "opencode-pcb-studio", status: "ok" }))
  app.get("/api/health", (ctx) => ctx.json({ status: "ok" }))
  app.get("/api/studio", (ctx) =>
    ctx.json({
      id: input.studioId,
      packageVersion: input.packageVersion,
      contractVersion: input.contractVersion,
    }),
  )
  // ── Workspace ───────────────────────────────────────────────────────────────
  app.get("/api/workspace", async (ctx) => {
    const projects = await discoverProjects(workspaceRoot)
    return ctx.json({ root: workspaceRoot, projectCount: projects.length })
  })

  // ── Projects ────────────────────────────────────────────────────────────────
  app.get("/api/projects", async (ctx) => {
    const projects = await discoverProjects(workspaceRoot)
    const limit = integerQuery(ctx.req.query("limit"), 50, 1, 200) ?? 50
    const offset = integerQuery(ctx.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER) ?? 0
    const page = projects.slice(offset, offset + limit)
    return ctx.json({ projects: page.map(projectSummary), total: projects.length, hasMore: offset + limit < projects.length })
  })

  app.get("/api/projects/:id", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    return ctx.json(projectDetail(project))
  })

  // ── Circuit JSON ─────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/circuit.json", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    if (!project.circuitJsonPath) return ctx.json({ error: "Circuit JSON not built yet. Run pcb_circuit_build first." }, 404)
    return serveWorkspaceFile(workspaceRoot, project.circuitJsonPath, "application/json")
  })

  // ── BOM ──────────────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/bom", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    if (!project.circuitJsonPath) return ctx.json({ error: "Circuit JSON not built yet. Run pcb_circuit_build first." }, 404)
    const json = await readCircuitJson(project.circuitJsonPath)
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

  app.get("/api/projects/:id/bom.csv", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    if (!project.circuitJsonPath) return ctx.json({ error: "Circuit JSON not built yet. Run pcb_circuit_build first." }, 404)
    const json = await readCircuitJson(project.circuitJsonPath)
    const catalogParts = await loadCatalogParts(workspaceRoot)
    const bom = generateBom(json, catalogParts)
    const csv = toBomCsv(bom.entries)
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.name}-bom.csv"`,
        "Cache-Control": "no-cache",
      },
    })
  })

  // ── Assembly (Pick & Place) ────────────────────────────────────────────────
  app.get("/api/projects/:id/assembly.csv", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    if (!project.circuitJsonPath) return ctx.json({ error: "Circuit JSON not built yet. Run pcb_circuit_build first." }, 404)
    const json = await readCircuitJson(project.circuitJsonPath)
    const fabricationBlockers = manufacturingBlockers(json)
    const bomBlocker = bomIdentityBlocker(generateBom(json))
    const assemblyBlockers = [...fabricationBlockers, ...(bomBlocker ? [bomBlocker] : [])]
    if (assemblyBlockers.length > 0) {
      return ctx.json(
        {
          error: "Assembly export blocked",
          fabricationReady: fabricationBlockers.length === 0,
          assemblyReady: false,
          assemblyBlockers,
        },
        409,
      )
    }
    const result = generatePickAndPlace(json)
    const csv = toCplCsv(result.entries)
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.name}-pick-and-place.csv"`,
        "Cache-Control": "no-cache",
      },
    })
  })

  // ── SVG Files ────────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/schematic.svg", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    if (!project.schematicSvgPath) return ctx.json({ error: "Schematic SVG not built yet. Run pcb_circuit_export first." }, 404)
    return serveWorkspaceFile(workspaceRoot, project.schematicSvgPath, "image/svg+xml")
  })

  app.get("/api/projects/:id/pcb.svg", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    if (!project.pcbSvgPath) return ctx.json({ error: "PCB SVG not built yet. Run pcb_circuit_export first." }, 404)
    return serveWorkspaceFile(workspaceRoot, project.pcbSvgPath, "image/svg+xml")
  })

  // ── Gerbers ──────────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/gerbers.zip", async (ctx) => {
    const project = await resolveProject(workspaceRoot, ctx.req.param("id")).catch(() => null)
    if (!project) return ctx.json({ error: "Project not found" }, 404)
    if (!project.gerbersZipPath) return ctx.json({ error: "Gerbers not exported yet. Run pcb_circuit_export with format 'gerber'." }, 404)
    return serveWorkspaceFile(workspaceRoot, project.gerbersZipPath, "application/zip", `${project.name}-gerbers.zip`)
  })

  // ── Project events (observation-only; rebuilds are agent-owned) ─────────────
  app.get("/api/events", async (ctx) => {
    await ensureWatching(workspaceRoot)
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected", at: Date.now() })}\n\n`))
        const unsubscribe = onProjectEvent((event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            unsubscribe()
          }
        })
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            clearInterval(heartbeat)
            unsubscribe()
          }
        }, 5000)
        heartbeat.unref()
        ctx.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeat)
          unsubscribe()
          try {
            controller.close()
          } catch {
            // already closed
          }
        })
      },
    })
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  })

  // ── Catalog ──────────────────────────────────────────────────────────────────
  app.get("/api/catalog", async (ctx) => {
    const parts = await loadCatalogParts(workspaceRoot)
    const q = ctx.req.query("q")?.toLowerCase()
    const filtered = q ? parts.filter((p) => JSON.stringify(p).toLowerCase().includes(q)) : parts
    return ctx.json({ parts: filtered.map(partSummary), total: filtered.length })
  })

  app.get("/api/catalog/:mpn", async (ctx) => {
    const part = await getCatalogPart(workspaceRoot, ctx.req.param("mpn"))
    if (!part) return ctx.json({ error: "Part not found" }, 404)
    return ctx.json(part)
  })

  // ── SPA fallback ─────────────────────────────────────────────────────────────
  if (input.uiDirectory) {
    const uiRoot = path.resolve(input.uiDirectory)
    app.all("/api/*", (ctx) => ctx.json({ error: "Not found" }, 404))
    app.get("*", async (ctx) => {
      let requestPath: string
      try {
        requestPath = decodeURIComponent(ctx.req.path)
      } catch {
        return ctx.json({ error: "Invalid path" }, 400)
      }

      const candidate = path.resolve(uiRoot, `.${requestPath}`)
      if (requestPath !== "/" && isInside(uiRoot, candidate)) {
        try {
          const info = await stat(candidate)
          if (info.isFile()) {
            const file = Bun.file(candidate)
            return new Response(file, {
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "Cache-Control": requestPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
              },
            })
          }
        } catch {
          // fall through to SPA
        }
      }

      const index = Bun.file(path.join(uiRoot, "index.html"))
      if (!(await index.exists())) return ctx.json({ error: "Companion UI not built; run bun run build:ui" }, 503)
      return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } })
    })
  }

  return app
}
