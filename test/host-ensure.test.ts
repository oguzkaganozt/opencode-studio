import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureStudioHost, probeParentOpenCode, resetStudioHostEnsureForTests, resolveStudioBind } from "../src/host-ensure"
import { normalizeParentOpenCodeUrl } from "../src/opencode-bridge"

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

  test("ensure starts host once and reuses", async () => {
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
    const packageRoot = path.resolve(import.meta.dir, "..")
    const first = await ensureStudioHost({
      parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
      workspace,
      packageRoot,
      uiDirectory: path.join(packageRoot, "dist", "ui"),
      env: { ...process.env, OPENCODE_STUDIO_AUTOSTART: "1" },
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.hostUrl).toContain("127.0.0.1:4173")

    const second = await ensureStudioHost({
      parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
      workspace: path.join(root, "other"),
      packageRoot,
      uiDirectory: path.join(packageRoot, "dist", "ui"),
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // Second call always reuses healthy :4173 (whether we started it or it was already up).
    expect(second.reused).toBe(true)
    expect(second.hostUrl).toBe(first.hostUrl)

    const health = await fetch(`${first.hostUrl}/studio-api/health`)
    expect(health.ok).toBe(true)
  }, 30_000)

  test("AUTOSTART=0 skips ensure", async () => {
    const result = await ensureStudioHost({
      parentOpenCodeUrl: "http://127.0.0.1:4096",
      workspace: "/tmp",
      autostart: "0",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("AUTOSTART")
  })

  test("web bind without password fails ensure", async () => {
    const result = await ensureStudioHost({
      parentOpenCodeUrl: "http://0.0.0.0:4096",
      workspace: "/tmp",
      env: { OPENCODE_STUDIO_AUTOSTART: "1" },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/PASSWORD/)
  })
})
