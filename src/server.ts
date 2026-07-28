import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { maybeMigrateLegacyConfig, readStudioConfigFile, resolveStudioRoot } from "./config"
import { errorBody } from "./core/errors"
import { loadPackageMeta } from "./core/package-meta"
import { isInside, packageRootFrom } from "./core/paths"
import type { StudioId } from "./core/registry"
import {
  allowedHost,
  assertNotRoot,
  basicAuthMatches,
  createCsrfToken,
  csrfTokensEqual,
  isLoopbackHost,
  resolveBasicUsername,
  resolveEdgePassword,
  sameOrigin,
  securityHeaders,
} from "./core/security"
import { checkNpmUpdate, scheduleUpdateLog } from "./core/update-check"
import { pickUserPaths, type UserPathOptions } from "./core/user-paths"
import { configureStudios, statusStudios } from "./lifecycle"
import { createOpenCodeBridge, normalizeParentOpenCodeUrl, type OpenCodeBridge } from "./opencode-bridge"
import { apiLoaders } from "./studio-loaders"
import { listStudioDefinitions } from "./studios"

export type HostInput = UserPathOptions & {
  workspace: string
  hostname?: string
  port?: number
  uiDirectory?: string
  packageRoot?: string
  packageVersion?: string
  /** Parent OpenCode HTTP base. Required unless `openCodeBridge` is injected. */
  parentOpenCodeUrl?: string
  openCodeBridge?: OpenCodeBridge
  /**
   * When true, register SIGINT/SIGTERM → stop + process.exit.
   * Default false (safe inside OpenCode plugin process).
   */
  handleSignals?: boolean
}

export type HostHandle = {
  server: ReturnType<typeof Bun.serve>
  url: string
  studioUrl: string
  parentOpenCodeUrl: string
  stop: () => void
}

type StudioMountState = {
  /** Routes live under /:studioId/... relative to this app */
  studios: Hono
}

async function buildStudioMounts(input: {
  workspace: string
  packageRoot: string
  userPaths: UserPathOptions
}): Promise<{ state: StudioMountState; mountErrors: string[] }> {
  // Enablement is user-global; workspace is domain data root only.
  try {
    await maybeMigrateLegacyConfig(input.workspace, input.userPaths)
  } catch {
    // fail-closed read below still applies
  }
  const config = await readStudioConfigFile(input.userPaths)
  const studios = new Hono()
  const mountErrors: string[] = []

  const loadCtx = {
    workspace: input.workspace,
    roots: config.roots,
    resolveStudioRoot,
  }
  // Domains always mounted (full catalog). Bad studio.json only drops optional roots.
  for (const studioId of Object.keys(apiLoaders) as StudioId[]) {
    try {
      const createApi = apiLoaders[studioId]
      const studioApp = await createApi(loadCtx)
      studios.route(`/${studioId}`, studioApp)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[opencode-studio] failed to mount ${studioId}:`, error)
      mountErrors.push(`${studioId}: ${message}`)
    }
  }

  return { state: { studios }, mountErrors }
}

export async function createHostApp(input: HostInput) {
  assertNotRoot("start the studio host")
  const hostname = input.hostname ?? "127.0.0.1"
  const port = input.port ?? 4173
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const packageVersion = input.packageVersion ?? meta.version
  const csrfToken = createCsrfToken()
  const env = input.env ?? process.env
  const parentOpenCodeUrl = input.parentOpenCodeUrl?.trim() ? normalizeParentOpenCodeUrl(input.parentOpenCodeUrl) : undefined
  if (!input.openCodeBridge && !parentOpenCodeUrl) {
    throw new Error("parentOpenCodeUrl or openCodeBridge is required")
  }
  const openCode =
    input.openCodeBridge ??
    createOpenCodeBridge({
      baseUrl: parentOpenCodeUrl!,
      workspace: input.workspace,
      env,
    })
  const resolvedParentUrl = parentOpenCodeUrl
  const nativeOpenCodeAvailable = Boolean(resolvedParentUrl || input.openCodeBridge)
  const userPaths = pickUserPaths(input)
  const domain = { workspace: input.workspace, packageRoot, userPaths }

  const initial = await buildStudioMounts(domain)
  if (initial.mountErrors.length > 0) {
    throw new Error(`Failed to mount studio API(s): ${initial.mountErrors.join("; ")}`)
  }

  const mount = { current: initial.state }

  const reloadStudios = async () => {
    const next = await buildStudioMounts(domain)
    mount.current = next.state
    return next
  }

  const { createFilesApi } = await import("./platform/media/files-api")
  const filesApi = await createFilesApi(input.workspace)

  const app = new Hono()

  const password = resolveEdgePassword(env)
  const username = resolveBasicUsername(env)
  const needBasic = !isLoopbackHost(hostname)

  app.use("*", async (ctx, next) => {
    const host = ctx.req.header("host")
    if (!allowedHost(host, hostname, port)) {
      return ctx.json(errorBody("invalid_host", "Host header rejected."), 400)
    }
    if (needBasic && new URL(ctx.req.url).pathname !== "/studio-api/health") {
      if (!password) {
        return new Response(JSON.stringify(errorBody("chat_auth_required", "Set OPENCODE_SERVER_PASSWORD or OPENCODE_STUDIO_PASSWORD.")), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (!basicAuthMatches(ctx.req.header("authorization"), username, password)) {
        return new Response(JSON.stringify(errorBody("unauthorized", "Basic auth required.")), {
          status: 401,
          headers: { "Content-Type": "application/json", "WWW-Authenticate": `Basic realm="opencode-studio"` },
        })
      }
    }
    await next()
    ctx.header("X-Content-Type-Options", "nosniff")
  })

  app.get("/studio-api/health", (ctx) => ctx.json({ status: "ok", parentOpenCodeUrl: resolvedParentUrl }))
  app.get("/api/csrf", (ctx) => ctx.json({ token: csrfToken }))

  app.get("/api/studios", async (ctx) => {
    const status = await statusStudios({ workspace: input.workspace, packageRoot, ...userPaths })
    const update = await checkNpmUpdate({ packageName: meta.name, current: packageVersion })
    return ctx.json({
      workspace: status.workspace,
      configPath: status.configPath,
      enabled: status.enabled,
      configError: status.configError,
      packageVersion,
      csrfRequired: true,
      studios: status.studios,
      checks: status.checks,
      ok: status.ok,
      catalog: listStudioDefinitions().map((def) => ({
        id: def.id,
        label: def.label,
        description: def.description,
        requiredEngines: def.requiredEngines,
        rootDefault: def.root.default,
      })),
      restartRequiredHint: status.restartRequiredHint,
      hostHotReload: true,
      nativeOpenCodeAvailable,
      update,
    })
  })

  app.get("/api/update", async (ctx) => {
    const update = await checkNpmUpdate({ packageName: meta.name, current: packageVersion })
    return ctx.json(update)
  })

  const writeGuard = async (ctx: any) => {
    const origin = ctx.req.header("origin")
    if (!sameOrigin(origin, hostname, port, env, ctx.req.header("host"))) {
      return ctx.json(errorBody("invalid_origin", "Origin header rejected."), 403)
    }
    const token = ctx.req.header("x-csrf-token")
    if (!token || !csrfTokensEqual(token, csrfToken)) {
      return ctx.json(errorBody("invalid_csrf", "CSRF token rejected."), 403)
    }
    return null
  }

  const openCodeError = (ctx: any, error: unknown) =>
    ctx.json(errorBody("opencode_error", error instanceof Error ? error.message : String(error)), 502)

  app.put("/api/config", async (ctx) => {
    if (!isLoopbackHost(hostname)) {
      return ctx.json(errorBody("remote_config_disabled", "Configure studios locally on the server."), 403)
    }
    const denied = await writeGuard(ctx)
    if (denied) return denied
    const body = (await ctx.req.json().catch(() => null)) as { roots?: unknown } | null
    // roots are CLI-only — HTTP configure must not repoint studio roots.
    if (body && body.roots !== undefined) {
      return ctx.json(errorBody("invalid_body", "roots cannot be set via HTTP; edit studio.json with absolute roots"), 400)
    }
    try {
      const result = await configureStudios({
        workspace: input.workspace,
        packageRoot,
        ...userPaths,
      })
      const reloaded = await reloadStudios()
      openCode.close()
      return ctx.json({
        ...result,
        hostReloaded: true,
        restartHost: false,
        restartOpenCode: true,
        restartRequired: true,
        mountErrors: reloaded.mountErrors,
        message:
          reloaded.mountErrors.length > 0
            ? `Install repaired; host reloaded with mount errors: ${reloaded.mountErrors.join("; ")}. Restart OpenCode.`
            : "Install repaired. Restart OpenCode to reload plugins and skills.",
      })
    } catch (error) {
      return ctx.json(errorBody("configure_failed", error instanceof Error ? error.message : String(error)), 400)
    }
  })

  app.route("/api/files", filesApi)

  // Dispatch to the hot-swappable studio mount table.
  app.all("/api/studios/*", async (ctx) => {
    const url = new URL(ctx.req.url)
    const suffix = url.pathname.replace(/^\/api\/studios/, "") || "/"
    return mount.current.studios.request(suffix + url.search, ctx.req.raw)
  })

  if (input.uiDirectory) {
    const uiRoot = path.resolve(input.uiDirectory)
    const serveStudioUi = async (ctx: any) => {
      let requestPath: string
      try {
        requestPath = decodeURIComponent(new URL(ctx.req.url).pathname)
      } catch {
        return ctx.json(errorBody("not_found", "Not found."), 404)
      }
      const relative = requestPath === "/studio" || requestPath === "/studio/" ? "index.html" : requestPath.replace(/^\/studio\/?/, "")
      const candidate = path.resolve(uiRoot, relative)
      if (!isInside(uiRoot, candidate) && requestPath !== "/studio") {
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
                ...securityHeaders(),
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
            ...securityHeaders(),
          },
        })
      } catch {
        return ctx.json(errorBody("ui_missing", "Viewer UI build not found; run bun run build:ui"), 503)
      }
    }
    app.get("/studio", serveStudioUi)
    app.get("/studio/*", serveStudioUi)
  }

  app.get("/studios/*", (ctx) => {
    const url = new URL(ctx.req.url)
    return ctx.redirect(`/studio${url.pathname}${url.search}`, 308)
  })

  app.all("*", async (ctx) => {
    // Basic already applied by global middleware when non-loopback.
    const origin = ctx.req.header("origin")
    if (origin && !sameOrigin(origin, hostname, port, env, ctx.req.header("host"))) {
      return ctx.json(errorBody("invalid_origin", "Origin header rejected."), 403)
    }
    try {
      return await openCode.proxy(ctx.req.raw)
    } catch (error) {
      return openCodeError(ctx, error)
    }
  })

  const config = await readStudioConfigFile(userPaths)
  return {
    app,
    csrfToken,
    hostname,
    port,
    packageVersion,
    config,
    reloadStudios,
    closeOpenCode: () => openCode.close(),
    openCodeAuthorized: (authorization: string | undefined) =>
      !needBasic || Boolean(password && basicAuthMatches(authorization, username, password)),
    openCodeAuthResponse: () => {
      if (!password) {
        return new Response(JSON.stringify(errorBody("chat_auth_required", "Set OPENCODE_SERVER_PASSWORD or OPENCODE_STUDIO_PASSWORD.")), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify(errorBody("unauthorized", "Basic auth required.")), {
        status: 401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": `Basic realm="opencode-studio"` },
      })
    },
    openCodeWebSocketTarget: (requestUrl: string) => openCode.webSocketTarget(requestUrl),
    nativeOpenCodeAvailable,
  }
}

export async function startHost(input: HostInput): Promise<HostHandle> {
  const { app, hostname, port, packageVersion, closeOpenCode, openCodeAuthorized, openCodeAuthResponse, openCodeWebSocketTarget } =
    await createHostApp(input)
  const packageRoot = input.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  scheduleUpdateLog({ packageName: meta.name, current: input.packageVersion ?? packageVersion })
  const updateTimer = setInterval(
    () => {
      scheduleUpdateLog({ packageName: meta.name, current: input.packageVersion ?? packageVersion })
    },
    24 * 60 * 60 * 1000,
  )
  if (typeof updateTimer.unref === "function") updateTimer.unref()

  type ProxySocketData = { target: string; upstream?: WebSocket; queued: Array<string | Buffer> }
  const server = Bun.serve<ProxySocketData>({
    hostname,
    port,
    async fetch(request, bunServer) {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const boundPort = bunServer.port
        if (typeof boundPort !== "number") return new Response("Server port unavailable", { status: 500 })
        const requestHost = request.headers.get("host") ?? undefined
        if (!allowedHost(requestHost, hostname, boundPort)) return new Response("Host header rejected", { status: 400 })
        const origin = request.headers.get("origin") ?? undefined
        if (origin && !sameOrigin(origin, hostname, boundPort, input.env ?? process.env, requestHost)) {
          return new Response("Origin header rejected", { status: 403 })
        }
        if (!openCodeAuthorized(request.headers.get("authorization") ?? undefined)) return openCodeAuthResponse()
        const target = await openCodeWebSocketTarget(request.url)
        const upgraded = bunServer.upgrade(request, { data: { target, queued: [] } })
        return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
      }
      return app.fetch(request)
    },
    websocket: {
      open(socket) {
        const upstream = new WebSocket(socket.data.target)
        socket.data.upstream = upstream
        upstream.binaryType = "arraybuffer"
        upstream.onopen = () => {
          for (const message of socket.data.queued) upstream.send(message)
          socket.data.queued.length = 0
        }
        upstream.onmessage = (event) => socket.send(event.data as string | ArrayBuffer)
        upstream.onclose = (event) => socket.close(event.code, event.reason)
        upstream.onerror = () => socket.close(1011, "OpenCode WebSocket proxy error")
      },
      message(socket, message) {
        const upstream = socket.data.upstream
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(message)
        else socket.data.queued.push(message)
      },
      close(socket, code, reason) {
        const upstream = socket.data.upstream
        if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close(code, reason)
      },
    },
  })
  const stop = () => {
    clearInterval(updateTimer)
    void import("../studios/cad/watcher").then((m) => m.closeAllDesignWatchers()).catch(() => {})
    void import("../studios/pcb/watcher").then((m) => m.closeAllProjectWatchers()).catch(() => {})
    closeOpenCode()
    server.stop(true)
  }
  if (input.handleSignals) {
    process.on("SIGINT", () => {
      stop()
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      stop()
      process.exit(0)
    })
  }
  const url = `http://${hostname}:${server.port}`
  const parentOpenCodeUrl = input.parentOpenCodeUrl?.trim() ? normalizeParentOpenCodeUrl(input.parentOpenCodeUrl) : "injected-bridge"
  return { server, url, studioUrl: `${url}/studio`, parentOpenCodeUrl, stop }
}
