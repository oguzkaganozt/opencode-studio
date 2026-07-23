import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { readStudioConfigFile, resolveStudioRoot } from "./config"
import { errorBody } from "./core/errors"
import { loadPackageMeta } from "./core/package-meta"
import { isInside, packageRootFrom } from "./core/paths"
import type { StudioId } from "./core/registry"
import { allowedHost, assertNotRoot, BASE_CSP, createCsrfToken, PCB_CSP, sameOrigin, securityHeaders } from "./core/security"
import { configureStudios, doctorStudios, statusStudios } from "./lifecycle"
import { apiLoaders } from "./studio-loaders"
import { listStudioDefinitions } from "./studios"

export type HostInput = {
  workspace: string
  hostname?: string
  port?: number
  uiDirectory?: string
  packageRoot?: string
  packageVersion?: string
}

function cspForPath(requestPath: string, pcbEnabled: boolean) {
  if (!pcbEnabled) return BASE_CSP
  if (requestPath.startsWith("/studios/pcb") || requestPath.startsWith("/api/studios/pcb")) return PCB_CSP
  return BASE_CSP
}

export async function createHostApp(input: HostInput) {
  assertNotRoot("start the studio host")
  const hostname = input.hostname ?? "127.0.0.1"
  const port = input.port ?? 4173
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const packageVersion = input.packageVersion ?? meta.version
  const csrfToken = createCsrfToken()
  const config = await readStudioConfigFile(input.workspace)

  const pcbEnabled = config.enabled.includes("pcb")
  const app = new Hono()

  app.use("*", async (ctx, next) => {
    const host = ctx.req.header("host")
    if (!allowedHost(host, hostname, port)) {
      return ctx.json(errorBody("invalid_host", "Host header rejected."), 400)
    }
    await next()
    let requestPath = "/"
    try {
      requestPath = new URL(ctx.req.url).pathname
    } catch {
      // keep default
    }
    ctx.header("X-Content-Type-Options", "nosniff")
    ctx.header("Content-Security-Policy", cspForPath(requestPath, pcbEnabled))
  })

  app.get("/api/health", (ctx) => ctx.json({ status: "ok" }))
  app.get("/api/csrf", (ctx) => ctx.json({ token: csrfToken }))

  app.get("/api/studios", async (ctx) => {
    const status = await statusStudios({ workspace: input.workspace, packageRoot })
    return ctx.json({
      workspace: status.workspace,
      enabled: status.enabled,
      configError: status.configError,
      packageVersion,
      csrfRequired: true,
      studios: status.studios,
      catalog: listStudioDefinitions().map((def) => ({
        id: def.id,
        label: def.label,
        description: def.description,
        requiredEngines: def.requiredEngines,
        rootDefault: def.root.default,
      })),
      restartRequiredHint: status.restartRequiredHint,
    })
  })

  app.get("/api/doctor", async (ctx) => {
    const result = await doctorStudios({ workspace: input.workspace, packageRoot })
    return ctx.json(result)
  })

  const writeGuard = async (ctx: any) => {
    const origin = ctx.req.header("origin")
    if (!sameOrigin(origin, hostname, port)) {
      return ctx.json(errorBody("invalid_origin", "Origin header rejected."), 403)
    }
    const token = ctx.req.header("x-csrf-token")
    if (!token || token !== csrfToken) {
      return ctx.json(errorBody("invalid_csrf", "CSRF token rejected."), 403)
    }
    return null
  }

  app.put("/api/config", async (ctx) => {
    const denied = await writeGuard(ctx)
    if (denied) return denied
    const body = (await ctx.req.json().catch(() => null)) as { enabled?: string[]; roots?: Record<string, string> } | null
    if (!body || !Array.isArray(body.enabled)) {
      return ctx.json(errorBody("invalid_body", "Body must include enabled: string[]"), 400)
    }
    try {
      const result = await configureStudios({
        workspace: input.workspace,
        enabled: body.enabled,
        roots: body.roots as Partial<Record<StudioId, string>> | undefined,
        packageRoot,
      })
      return ctx.json(result)
    } catch (error) {
      return ctx.json(errorBody("configure_failed", error instanceof Error ? error.message : String(error)), 400)
    }
  })

  // Mount enabled studio APIs — any failure aborts host creation
  if (!config.error) {
    const mountErrors: string[] = []
    const loadCtx = {
      workspace: input.workspace,
      roots: config.roots,
      resolveStudioRoot,
    }
    for (const studioId of config.enabled) {
      try {
        const createApi = apiLoaders[studioId]
        const studioApp = await createApi(loadCtx)
        app.route(`/api/studios/${studioId}`, studioApp)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[opencode-studio] failed to mount ${studioId}:`, error)
        mountErrors.push(`${studioId}: ${message}`)
      }
    }
    if (mountErrors.length > 0) {
      throw new Error(`Failed to mount enabled studio API(s): ${mountErrors.join("; ")}`)
    }
  }

  app.all("/api/*", (ctx) => ctx.json(errorBody("not_found", "API route was not found."), 404))

  if (input.uiDirectory) {
    const uiRoot = path.resolve(input.uiDirectory)
    app.get("*", async (ctx) => {
      let requestPath: string
      try {
        requestPath = decodeURIComponent(new URL(ctx.req.url).pathname)
      } catch {
        return ctx.json(errorBody("not_found", "Not found."), 404)
      }
      const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\//, "")
      const candidate = path.resolve(uiRoot, relative)
      if (!isInside(uiRoot, candidate) && requestPath !== "/") {
        // SPA fallback
      } else {
        try {
          const info = await stat(candidate)
          if (info.isFile() && isInside(uiRoot, candidate)) {
            const content = await readFile(candidate)
            const ext = path.extname(candidate)
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
                ...securityHeaders(cspForPath(requestPath, pcbEnabled)),
              },
            })
          }
        } catch {
          // fall through
        }
      }
      try {
        const index = await readFile(path.join(uiRoot, "index.html"))
        return new Response(index, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            ...securityHeaders(cspForPath(requestPath, pcbEnabled)),
          },
        })
      } catch {
        return ctx.json(errorBody("ui_missing", "Viewer UI build not found; run bun run build:ui"), 503)
      }
    })
  }

  return { app, csrfToken, hostname, port, packageVersion, config }
}

export async function startHost(input: HostInput) {
  const { app, hostname, port } = await createHostApp(input)
  const server = Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
  })
  const stop = () => {
    server.stop(true)
  }
  process.on("SIGINT", () => {
    stop()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    stop()
    process.exit(0)
  })
  return { server, url: `http://${hostname}:${port}`, stop }
}
