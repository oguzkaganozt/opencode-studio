import { Hono } from "hono"
import { listCandidates, loadRejects, readCandidate } from "./pool"

function errorBody(code: string, message: string) {
  return { error: { code, message } }
}

export function createStartupApi(dataRoot: string) {
  const app = new Hono()

  app.get("/candidates", async (ctx) => {
    try {
      const minTotalRaw = ctx.req.query("minTotal")
      const minTotal = minTotalRaw !== undefined ? Number(minTotalRaw) : undefined
      const signalClass = ctx.req.query("signalClass") as "A" | "B" | undefined
      const verdict = ctx.req.query("verdict") as "verified" | "partial" | "unverified" | undefined
      const candidates = await listCandidates(dataRoot, {
        minTotal: Number.isFinite(minTotal) ? minTotal : undefined,
        signalClass: signalClass === "A" || signalClass === "B" ? signalClass : undefined,
        verdict: verdict === "verified" || verdict === "partial" || verdict === "unverified" ? verdict : undefined,
      })
      return ctx.json({ candidates })
    } catch (error) {
      return ctx.json(errorBody("pool_error", error instanceof Error ? error.message : "Failed to load pool"), 500)
    }
  })

  app.get("/candidates/:id", async (ctx) => {
    try {
      const entry = await readCandidate(dataRoot, ctx.req.param("id"))
      return ctx.json(entry)
    } catch {
      return ctx.json(errorBody("resource_not_found", "Resource was not found."), 404)
    }
  })

  app.get("/rejects", async (ctx) => {
    try {
      const rejects = await loadRejects(dataRoot)
      return ctx.json({
        rejects: rejects.map((r) => ({
          name: r.name,
          problem: r.problem,
          reason: r.reason,
          batch: r.batch,
          first_seen: r.first_seen,
        })),
      })
    } catch (error) {
      return ctx.json(errorBody("rejects_error", error instanceof Error ? error.message : "Failed to load rejects"), 500)
    }
  })

  return app
}
