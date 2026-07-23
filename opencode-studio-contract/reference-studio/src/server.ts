import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { listNotes, readNote } from "./notes"
import { isInside, readRegularFileInside } from "./studio-path"

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

export function createReferenceStudioApp(input: CompanionAppInput) {
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

  app.get("/api/notes", async (ctx) => {
    const notes = await listNotes(input.dataRoot)
    return ctx.json({
      notes: notes.map((note) => ({ id: note.id, title: note.title })),
    })
  })

  app.get("/api/notes/:id", async (ctx) => {
    try {
      const note = await readNote(input.dataRoot, ctx.req.param("id"))
      return ctx.json(note)
    } catch {
      return ctx.json(errorBody("resource_not_found", "Resource was not found."), 404)
    }
  })

  app.get("/api/notes/:id/raw", async (ctx) => {
    try {
      const content = await readRegularFileInside(input.dataRoot, `${ctx.req.param("id")}.note.json`)
      return new Response(new Uint8Array(content), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": CSP,
        },
      })
    } catch {
      return ctx.json(errorBody("resource_not_found", "Resource was not found."), 404)
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
