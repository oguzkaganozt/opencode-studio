import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { configureStudios } from "../src/lifecycle"
import { createHostApp } from "../src/server"

const packageRoot = path.resolve(import.meta.dir, "..")
const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("host server", () => {
  test("health and fail-closed studios list", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-srv-"))
    temps.push(workspace)
    const { app } = await createHostApp({ workspace, packageRoot, hostname: "127.0.0.1", port: 4173 })
    const health = await app.request("http://127.0.0.1:4173/api/health", { headers: { host: "127.0.0.1:4173" } })
    expect(health.status).toBe(200)
    const studios = await app.request("http://127.0.0.1:4173/api/studios", { headers: { host: "127.0.0.1:4173" } })
    const body = await studios.json()
    expect(body.enabled).toEqual([])
  })

  test("rejects bad host", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-srv-"))
    temps.push(workspace)
    const { app } = await createHostApp({ workspace, packageRoot, hostname: "127.0.0.1", port: 4173 })
    const response = await app.request("http://evil.test/api/health", { headers: { host: "evil.test" } })
    expect(response.status).toBe(400)
  })

  test("configure requires csrf and origin", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-srv-"))
    temps.push(workspace)
    const { app, csrfToken } = await createHostApp({ workspace, packageRoot, hostname: "127.0.0.1", port: 4173 })
    const denied = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(denied.status).toBe(403)

    const ok = await app.request("http://127.0.0.1:4173/api/config", {
      method: "PUT",
      headers: {
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ enabled: ["startup"] }),
    })
    expect(ok.status).toBe(200)
  })

  test("mounts startup routes when enabled", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-srv-"))
    temps.push(workspace)
    await configureStudios({ workspace, enabled: ["startup"], packageRoot, validateOpenCode: false })
    const { app } = await createHostApp({ workspace, packageRoot, hostname: "127.0.0.1", port: 4173 })
    const response = await app.request("http://127.0.0.1:4173/api/studios/startup/candidates", {
      headers: { host: "127.0.0.1:4173" },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.candidates)).toBe(true)
  })
})
