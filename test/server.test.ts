import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { configureStudios } from "../src/lifecycle"
import { createHostApp } from "../src/server"

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

describe("host server", () => {
  test("health and fail-closed studios list", async () => {
    const ctx = await isolatedHost()
    const { app } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })
    const health = await app.request("http://127.0.0.1:4173/api/health", { headers: { host: "127.0.0.1:4173" } })
    expect(health.status).toBe(200)
    const studios = await app.request("http://127.0.0.1:4173/api/studios", { headers: { host: "127.0.0.1:4173" } })
    const body = await studios.json()
    expect(body.enabled).toEqual([])
  })

  test("rejects bad host", async () => {
    const ctx = await isolatedHost()
    const { app } = await createHostApp({ ...ctx, hostname: "127.0.0.1", port: 4173 })
    const response = await app.request("http://evil.test/api/health", { headers: { host: "evil.test" } })
    expect(response.status).toBe(400)
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
