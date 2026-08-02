import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureStudioHost, probeParentOpenCode, resetStudioHostEnsureForTests, resolveStudioBind } from "../src/host-ensure"
import { normalizeParentOpenCodeUrl } from "../src/opencode-bridge"
import { defaultStudioRoot } from "../src/serve-bootstrap"

const temps: string[] = []
const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(async () => {
  resetStudioHostEnsureForTests()
  for (const server of servers.splice(0)) server.stop(true)
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("host ensure", () => {
  test("normalizes parent bind hosts", () => {
    expect(normalizeParentOpenCodeUrl("http://0.0.0.0:4096/")).toBe("http://127.0.0.1:4096")
  })

  test("resolveStudioBind follows parent 0.0.0.0 and env overrides", () => {
    expect(resolveStudioBind("http://127.0.0.1:4096", {}).hostname).toBe("127.0.0.1")
    expect(resolveStudioBind("http://0.0.0.0:4096", {}).hostname).toBe("0.0.0.0")
    expect(resolveStudioBind("http://127.0.0.1:4096", { OPENCODE_STUDIO_BIND: "web" }).hostname).toBe("0.0.0.0")
    expect(resolveStudioBind("http://127.0.0.1:4096", { OPENCODE_STUDIO_PORT: "4199" }).port).toBe(4199)
  })

  test("default Studio Home uses an explicit root or HOME", () => {
    expect(defaultStudioRoot({ OPENCODE_STUDIO_WORKSPACE: "/srv/studio", HOME: "/home/ignored" })).toBe("/srv/studio")
    expect(defaultStudioRoot({ HOME: "/home/studio" })).toBe("/home/studio")
  })

  test("probeParentOpenCode requires reachable parent", async () => {
    const up = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/global/health") return new Response("ok")
        return new Response("no", { status: 404 })
      },
    })
    servers.push(up)
    expect(await probeParentOpenCode(`http://127.0.0.1:${up.port}`)).toBe(true)
    expect(await probeParentOpenCode("http://127.0.0.1:1")).toBe(false)
  })

  test("ensure starts host once and keeps Studio Home fixed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-ensure-"))
    temps.push(root)
    const workspace = path.join(root, "ws")
    await mkdir(workspace, { recursive: true })
    const parent = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/global/health") return new Response("ok")
        return new Response("<html><title>OpenCode</title><div id='root'>ok</div></html>", {
          headers: { "Content-Type": "text/html" },
        })
      },
    })
    servers.push(parent)
    // Reserve an free port, then release so ensure can bind it (avoid clashing with a live :4173).
    const reserve = Bun.serve({ port: 0, fetch: () => new Response("ok") })
    const freePort = reserve.port
    reserve.stop(true)
    const packageRoot = path.resolve(import.meta.dir, "..")
    const env = {
      ...process.env,
      OPENCODE_STUDIO_AUTOSTART: "1",
      OPENCODE_STUDIO_PORT: String(freePort),
    }
    const first = await ensureStudioHost({
      parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
      studioRoot: workspace,
      packageRoot,
      uiDirectory: path.join(packageRoot, "dist", "ui"),
      env,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error(`ensure failed: ${first.reason}`)
    }
    expect(first.hostUrl).toBe(`http://127.0.0.1:${freePort}`)
    expect(first.studioRoot).toBe(workspace)

    const other = path.join(root, "other")
    await mkdir(other, { recursive: true })
    const second = await ensureStudioHost({
      parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
      studioRoot: other,
      packageRoot,
      uiDirectory: path.join(packageRoot, "dist", "ui"),
      env,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toContain(workspace)
    expect(second.reason).toContain(other)

    const health = await fetch(`${first.hostUrl}/studio-api/health`)
    expect(health.ok).toBe(true)
    const healthBody = (await health.json()) as { studioRoot?: string }
    expect(healthBody.studioRoot).toBe(workspace)
  }, 30_000)

  test("matching Studio Home on a foreign host is adopted without mutation", async () => {
    const requests: string[] = []
    const foreign = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        requests.push(`${req.method} ${url.pathname}`)
        if (url.pathname === "/studio-api/health") {
          return Response.json({ status: "ok", studioRoot: "/tmp/adopt-root" })
        }
        return new Response("no", { status: 404 })
      },
    })
    servers.push(foreign)
    const parent = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/global/health") return new Response("ok")
        return new Response("no", { status: 404 })
      },
    })
    servers.push(parent)
    const result = await ensureStudioHost({
      parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
      studioRoot: "/tmp/adopt-root",
      env: {
        ...process.env,
        OPENCODE_STUDIO_AUTOSTART: "1",
        OPENCODE_STUDIO_PORT: String(foreign.port),
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reused).toBe(true)
    expect(result.hostUrl).toBe(`http://127.0.0.1:${foreign.port}`)
    expect(result.studioRoot).toBe("/tmp/adopt-root")
    expect(requests).toEqual(["GET /studio-api/health"])
  })

  test("owned host stays up across ensure; stop only via test reset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-ensure-dispose-"))
    temps.push(root)
    const workspace = path.join(root, "ws")
    await mkdir(workspace, { recursive: true })
    const parent = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/global/health") return new Response("ok")
        return new Response("ok")
      },
    })
    servers.push(parent)
    const reserve = Bun.serve({ port: 0, fetch: () => new Response("ok") })
    const freePort = reserve.port
    reserve.stop(true)
    const packageRoot = path.resolve(import.meta.dir, "..")
    const env = {
      ...process.env,
      OPENCODE_STUDIO_AUTOSTART: "1",
      OPENCODE_STUDIO_PORT: String(freePort),
    }
    const first = await ensureStudioHost({
      parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
      studioRoot: workspace,
      packageRoot,
      uiDirectory: path.join(packageRoot, "dist", "ui"),
      env,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.reason)
    // Simulate plugin dispose: do not call reset/stop — host must remain healthy.
    const mid = await fetch(`${first.hostUrl}/studio-api/health`)
    expect(mid.ok).toBe(true)
    const again = await ensureStudioHost({
      parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
      studioRoot: workspace,
      packageRoot,
      uiDirectory: path.join(packageRoot, "dist", "ui"),
      env,
    })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.reused).toBe(true)
    resetStudioHostEnsureForTests()
    const afterStop = await fetch(`${first.hostUrl}/studio-api/health`).catch(() => null)
    expect(afterStop?.ok ?? false).toBe(false)
  }, 30_000)

  test("AUTOSTART=0 skips ensure", async () => {
    const result = await ensureStudioHost({
      parentOpenCodeUrl: "http://127.0.0.1:4096",
      studioRoot: "/tmp",
      autostart: "0",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("AUTOSTART")
  })

  test("web bind without password fails ensure", async () => {
    const result = await ensureStudioHost({
      parentOpenCodeUrl: "http://0.0.0.0:4096",
      studioRoot: "/tmp",
      env: { OPENCODE_STUDIO_AUTOSTART: "1" },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/PASSWORD/)
  })
})
