import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { listCandidates, loadRejects, readCandidate } from "./pool"
import { isInside } from "./studio-path"

const CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'"

function errorBody(code: string, message: string) {
  return { error: { code, message } }
}

function allowedHost(hostHeader: string | undefined, hostname: string, port: number) {
  if (!hostHeader) return false
  const allowed = new Set([
    `${hostname}:${port}`,
    hostname,
    `127.0.0.1:${port}`,
    "127.0.0.1",
    `localhost:${port}`,
    "localhost",
  ])
  if (hostname === "127.0.0.1") {
    allowed.add(`[::1]:${port}`)
    allowed.add("[::1]")
    allowed.add(`::1:${port}`)
    allowed.add("::1")
  }
  return allowed.has(hostHeader)
}

export type CompanionAppInput = {
  dataRoot: string
  hostname: string
  port: number
  studioId: string
  packageVersion: string
  contractVersion: string
  uiDirectory?: string
}

export function createStartupStudioApp(input: CompanionAppInput) {
  const app = new Hono()

  app.use("*", async (ctx, next) => {
    const host = ctx.req.header("host")
    if (!allowedHost(host, input.hostname, input.port)) {
      return ctx.json(errorBody("invalid_host", "Host header rejected."), 400)
    }
    await next()
    ctx.header("X-Content-Type-Options", "nosniff")
    ctx.header("Content-Security-Policy", CSP)
  })

  app.get("/api/health", (ctx) => ctx.json({ status: "ok" }))

  app.get("/api/studio", (ctx) =>
    ctx.json({
      id: input.studioId,
      packageVersion: input.packageVersion,
      contractVersion: input.contractVersion,
    }),
  )

  app.get("/api/candidates", async (ctx) => {
    try {
      const minTotalRaw = ctx.req.query("minTotal")
      const minTotal = minTotalRaw !== undefined ? Number(minTotalRaw) : undefined
      const signalClass = ctx.req.query("signalClass") as "A" | "B" | undefined
      const verdict = ctx.req.query("verdict") as "verified" | "partial" | "unverified" | undefined
      const candidates = await listCandidates(input.dataRoot, {
        minTotal: Number.isFinite(minTotal) ? minTotal : undefined,
        signalClass: signalClass === "A" || signalClass === "B" ? signalClass : undefined,
        verdict:
          verdict === "verified" || verdict === "partial" || verdict === "unverified" ? verdict : undefined,
      })
      return ctx.json({ candidates })
    } catch (error) {
      return ctx.json(
        errorBody("pool_error", error instanceof Error ? error.message : "Failed to load pool"),
        500,
      )
    }
  })

  app.get("/api/candidates/:id", async (ctx) => {
    try {
      const entry = await readCandidate(input.dataRoot, ctx.req.param("id"))
      return ctx.json(entry)
    } catch {
      return ctx.json(errorBody("resource_not_found", "Resource was not found."), 404)
    }
  })

  app.get("/api/rejects", async (ctx) => {
    try {
      const rejects = await loadRejects(input.dataRoot)
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
      return ctx.json(
        errorBody("rejects_error", error instanceof Error ? error.message : "Failed to load rejects"),
        500,
      )
    }
  })

  app.all("/api/*", (ctx) => ctx.json(errorBody("not_found", "API route was not found."), 404))

  if (input.uiDirectory) {
    const uiRoot = path.resolve(input.uiDirectory)
    app.get("*", async (ctx) => {
      const requestPath = decodeURIComponent(new URL(ctx.req.url).pathname)
      const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\//, "")
      const candidate = path.resolve(uiRoot, relative)
      if (!isInside(uiRoot, candidate)) {
        return ctx.json(errorBody("not_found", "Not found."), 404)
      }

      let filePath = candidate
      try {
        const info = await stat(candidate)
        if (info.isDirectory()) filePath = path.join(candidate, "index.html")
      } catch {
        filePath = path.join(uiRoot, "index.html")
      }

      if (!isInside(uiRoot, filePath)) {
        return ctx.json(errorBody("not_found", "Not found."), 404)
      }

      try {
        const content = await readFile(filePath)
        const ext = path.extname(filePath)
        const type =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".js"
              ? "text/javascript; charset=utf-8"
              : ext === ".css"
                ? "text/css; charset=utf-8"
                : ext === ".svg"
                  ? "image/svg+xml"
                  : ext === ".woff2"
                    ? "font/woff2"
                    : "application/octet-stream"
        return new Response(content, {
          headers: {
            "Content-Type": type,
            "Cache-Control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": CSP,
          },
        })
      } catch {
        return ctx.json(errorBody("not_found", "Not found."), 404)
      }
    })
  }

  return app
}
