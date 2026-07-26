import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { configureStudios } from "../src/lifecycle"
import type { OpenCodeBridge } from "../src/opencode-bridge"
import { createHostApp, startHost } from "../src/server"

const packageRoot = path.resolve(import.meta.dir, "..")
const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function isolatedHost() {
  const root = await mkdtemp(path.join(tmpdir(), "osc-srv-"))
  temps.push(root)
  const workspace = path.join(root, "domain")
  await mkdir(workspace, { recursive: true })
  return {
    workspace,
    studioConfigHome: path.join(root, "studio-config"),
    openCodeHome: path.join(root, "opencode-config"),
    packageRoot,
  }
}

function fakeOpenCodeBridge() {
  const prompts: Array<{ sessionID: string; text: string }> = []
  const proxyRequests: string[] = []
  const bridge: OpenCodeBridge = {
    health: async () => ({ healthy: true, version: "test" }),
    sessions: async () => [],
    createSession: async ({ title, studioId }) =>
      ({
        id: "session-1",
        slug: "session-1",
        projectID: "project",
        directory: "/tmp",
        title,
        version: "test",
        metadata: { "opencode-studio": studioId },
        time: { created: 1, updated: 1 },
      }) as Awaited<ReturnType<OpenCodeBridge["createSession"]>>,
    state: async () => ({ messages: [], status: { type: "idle" }, permissions: [], questions: [] }),
    prompt: async (sessionID, text) => {
      prompts.push({ sessionID, text })
    },
    abort: async () => {},
    replyPermission: async () => {},
    replyQuestion: async () => {},
    proxy: async (request) => {
      proxyRequests.push(request.url)
      return new Response("OpenCode proxy")
    },
    webSocketTarget: async () => "ws://127.0.0.1:4096",
    close: () => {},
  }
  return { bridge, prompts, proxyRequests }
}

describe("host server", () => {
  test("health and fail-closed studios list", async () => {
    const ctx = await isolatedHost()
    const { app } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })
    const health = await app.request("http://127.0.0.1:4173/studio-api/health", { headers: { host: "127.0.0.1:4173" } })
    expect(health.status).toBe(200)
    const studios = await app.request("http://127.0.0.1:4173/api/studios", { headers: { host: "127.0.0.1:4173" } })
    const body = await studios.json()
    expect(body.enabled).toEqual([])
    expect(body.nativeOpenCodeAvailable).toBe(true)
  })

  test("rejects bad host", async () => {
    const ctx = await isolatedHost()
    const { app } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })
    const response = await app.request("http://evil.test/api/health", { headers: { host: "evil.test" } })
    expect(response.status).toBe(400)
  })

  test("serves Studio under /studio and proxies OpenCode at root", async () => {
    const ctx = await isolatedHost()
    const uiDirectory = path.join(ctx.workspace, "ui")
    await mkdir(uiDirectory)
    await writeFile(path.join(uiDirectory, "index.html"), "<main>Studio shell</main>")
    const fake = fakeOpenCodeBridge()
    const { app } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173, uiDirectory, openCodeBridge: fake.bridge })

    const studio = await app.request("http://127.0.0.1:4173/studio", { headers: { host: "127.0.0.1:4173" } })
    expect(studio.status).toBe(200)
    expect(await studio.text()).toContain("Studio shell")

    const openCode = await app.request("http://127.0.0.1:4173/", { headers: { host: "127.0.0.1:4173" } })
    expect(openCode.status).toBe(200)
    expect(await openCode.text()).toBe("OpenCode proxy")
    expect(fake.proxyRequests).toEqual(["http://127.0.0.1:4173/"])

    const foreignOrigin = await app.request("http://127.0.0.1:4173/session", {
      headers: { host: "127.0.0.1:4173", origin: "http://evil.example" },
    })
    expect(foreignOrigin.status).toBe(403)

    const legacy = await app.request("http://127.0.0.1:4173/studios/cad", { headers: { host: "127.0.0.1:4173" }, redirect: "manual" })
    expect(legacy.status).toBe(308)
    expect(legacy.headers.get("location")).toBe("/studio/studios/cad")
  })

  test("reports native OpenCode unavailable when attached to a shared server", async () => {
    const ctx = await isolatedHost()
    const fake = fakeOpenCodeBridge()
    const { app } = await createHostApp({
      ...ctx,
      hostname: "127.0.0.1",
      port: 4173,
      env: { OPENCODE_STUDIO_OPENCODE_URL: "http://127.0.0.1:4096" },
      openCodeBridge: fake.bridge,
    })
    const response = await app.request("http://127.0.0.1:4173/api/studios", { headers: { host: "127.0.0.1:4173" } })
    expect((await response.json()).nativeOpenCodeAvailable).toBe(false)
  })

  test("configure requires csrf and origin (matrix)", async () => {
    const ctx = await isolatedHost()
    const { app, csrfToken } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })

    const noOriginNoToken = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(noOriginNoToken.status).toBe(403)

    const goodOriginBadToken = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173", "content-type": "application/json", "x-csrf-token": "wrong" },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(goodOriginBadToken.status).toBe(403)

    const badOriginGoodToken = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: { host: "127.0.0.1:4173", origin: "http://evil.com:4173", "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(badOriginGoodToken.status).toBe(403)

    const devOrigin = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:5173", "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(devOrigin.status).toBe(200)

    const bareOrigin = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1", "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(bareOrigin.status).toBe(403)
  })

  test("configure rejects roots via HTTP", async () => {
    const ctx = await isolatedHost()
    const { app, csrfToken } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })
    const response = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173", "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ enabled: ["startup"], roots: { startup: "/tmp/evil" } }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe("invalid_body")
  })

  test("chat creates a session and submits prompts with csrf", async () => {
    const ctx = await isolatedHost()
    const fake = fakeOpenCodeBridge()
    const { app, csrfToken } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173, openCodeBridge: fake.bridge })
    const headers = {
      host: "127.0.0.1:4173",
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
    }

    const created = await app.request("http://127.0.0.1:4173/api/chat/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "CAD Studio", studioId: "cad" }),
    })
    expect(created.status).toBe(201)
    expect((await created.json()).id).toBe("session-1")

    const prompted = await app.request("http://127.0.0.1:4173/api/chat/sessions/session-1/prompts", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "Build an enclosure" }),
    })
    expect(prompted.status).toBe(202)
    expect(fake.prompts).toEqual([{ sessionID: "session-1", text: "Build an enclosure" }])
  })

  test("chat requires a password on non-loopback hosts", async () => {
    const ctx = await isolatedHost()
    const fake = fakeOpenCodeBridge()
    const { app } = await createHostApp({
      ...ctx,
      hostname: "0.0.0.0",
      port: 4173,
      openCodeBridge: fake.bridge,
      env: {},
    })
    const response = await app.request("http://192.168.1.20:4173/api/chat/sessions", { headers: { host: "192.168.1.20:4173" } })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe("chat_auth_required")

    const config = await app.request("http://192.168.1.20:4173/api/config", {
      method: "PUT",
      headers: { host: "192.168.1.20:4173", origin: "http://192.168.1.20:4173", "content-type": "application/json" },
      body: JSON.stringify({ enabled: ["cad"] }),
    })
    expect(config.status).toBe(403)
    expect((await config.json()).error.code).toBe("remote_config_disabled")

    const openCode = await app.request("http://192.168.1.20:4173/", { headers: { host: "192.168.1.20:4173" } })
    expect(openCode.status).toBe(503)
  })

  test("authenticated remote chat accepts the browser request origin", async () => {
    const ctx = await isolatedHost()
    const fake = fakeOpenCodeBridge()
    const env = { OPENCODE_STUDIO_PASSWORD: "secret" }
    const { app, csrfToken } = await createHostApp({
      ...ctx,
      hostname: "0.0.0.0",
      port: 4173,
      openCodeBridge: fake.bridge,
      env,
    })
    const response = await app.request("http://192.168.1.20:4173/api/chat/sessions", {
      method: "POST",
      headers: {
        host: "192.168.1.20:4173",
        origin: "http://192.168.1.20:4173",
        authorization: `Basic ${Buffer.from("opencode-studio:secret").toString("base64")}`,
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ title: "CAD Studio", studioId: "cad" }),
    })
    expect(response.status).toBe(201)

    const openCode = await app.request("http://192.168.1.20:4173/", {
      headers: {
        host: "192.168.1.20:4173",
        authorization: `Basic ${Buffer.from("opencode-studio:secret").toString("base64")}`,
      },
    })
    expect(openCode.status).toBe(200)
    expect(await openCode.text()).toBe("OpenCode proxy")

    const foreignOrigin = await app.request("http://192.168.1.20:4173/session", {
      headers: {
        host: "192.168.1.20:4173",
        origin: "http://evil.example",
        authorization: `Basic ${Buffer.from("opencode-studio:secret").toString("base64")}`,
      },
    })
    expect(foreignOrigin.status).toBe(403)
  })

  test("proxies OpenCode WebSocket traffic", async () => {
    const ctx = await isolatedHost()
    const upstream = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return
        return new Response("upgrade required", { status: 426 })
      },
      websocket: {
        message(socket, message) {
          socket.send(message)
        },
      },
    })
    const fake = fakeOpenCodeBridge()
    fake.bridge.webSocketTarget = async () => `ws://127.0.0.1:${upstream.port}/echo`
    const host = await startHost({ ...ctx, hostname: "127.0.0.1", port: 0, openCodeBridge: fake.bridge })
    try {
      const socket = new WebSocket(`${host.url.replace("http:", "ws:")}/api/pty/test`)
      const echoed = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket echo timed out")), 5_000)
        socket.onopen = () => socket.send("studio-ws")
        socket.onmessage = (event) => {
          clearTimeout(timer)
          resolve(String(event.data))
          socket.close()
        }
        socket.onerror = () => reject(new Error("WebSocket proxy failed"))
      })
      expect(echoed).toBe("studio-ws")
    } finally {
      host.stop()
      upstream.stop(true)
    }
  })

  test("mounts startup routes when enabled", async () => {
    const ctx = await isolatedHost()
    await configureStudios({
      ...ctx,
      enabled: ["startup"],
      validateOpenCode: false,
    })
    const { app } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })
    const response = await app.request("http://127.0.0.1:4173/api/studios/startup/candidates", {
      headers: { host: "127.0.0.1:4173" },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.candidates)).toBe(true)
  })

  test("configure hot-reloads studio API mounts without process restart", async () => {
    const ctx = await isolatedHost()
    const { app, csrfToken } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })

    const before = await app.request("http://127.0.0.1:4173/api/studios/startup/candidates", {
      headers: { host: "127.0.0.1:4173" },
    })
    expect(before.status).toBe(404)

    const applied = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: {
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(applied.status).toBe(200)
    const appliedBody = await applied.json()
    expect(appliedBody.hostReloaded).toBe(true)
    expect(appliedBody.restartHost).toBe(false)
    expect(appliedBody.restartOpenCode).toBe(true)

    const after = await app.request("http://127.0.0.1:4173/api/studios/startup/candidates", {
      headers: { host: "127.0.0.1:4173" },
    })
    expect(after.status).toBe(200)
    const afterBody = await after.json()
    expect(Array.isArray(afterBody.candidates)).toBe(true)

    const disabled = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: {
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ enabled: [] }),
    })
    expect(disabled.status).toBe(200)

    const gone = await app.request("http://127.0.0.1:4173/api/studios/startup/candidates", {
      headers: { host: "127.0.0.1:4173" },
    })
    expect(gone.status).toBe(404)
  })
})
