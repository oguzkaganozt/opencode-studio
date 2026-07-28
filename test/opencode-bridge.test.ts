import { afterEach, describe, expect, test } from "bun:test"
import { createOpenCodeBridge, normalizeParentOpenCodeUrl } from "../src/opencode-bridge"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("OpenCode bridge", () => {
  test("normalizes bind-any parent hosts to loopback", () => {
    expect(normalizeParentOpenCodeUrl("http://0.0.0.0:4096")).toBe("http://127.0.0.1:4096")
    expect(normalizeParentOpenCodeUrl("http://127.0.0.1:4096/")).toBe("http://127.0.0.1:4096")
  })

  test("pins native API requests to the host workspace and replaces browser auth", async () => {
    const upstream = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        return Response.json({
          pathname: url.pathname,
          directory: url.searchParams.get("directory"),
          locationDirectory: url.searchParams.get("location[directory]"),
          headerDirectory: request.headers.get("x-opencode-directory"),
          authorization: request.headers.get("authorization"),
          body: request.method === "POST" ? await request.json() : null,
        })
      },
    })
    servers.push(upstream)
    const bridge = createOpenCodeBridge({
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      workspace: "/srv/project",
      env: { OPENCODE_SERVER_PASSWORD: "sidecar-secret" },
    })

    const response = await bridge.proxy(
      new Request(
        "http://studio.test/session?directory=%2Fetc&workspace=other&location%5Bdirectory%5D=%2Froot&location%5Bworkspace%5D=bad",
        {
          headers: { authorization: "Basic browser-credential", "x-opencode-directory": encodeURIComponent("/tmp/evil") },
        },
      ),
    )
    const body = await response.json()
    expect(body.pathname).toBe("/session")
    expect(body.directory).toBe("/srv/project")
    expect(body.locationDirectory).toBe("/srv/project")
    expect(body.headerDirectory).toBe(encodeURIComponent("/srv/project"))
    expect(body.authorization).toBe(`Basic ${Buffer.from("opencode:sidecar-secret").toString("base64")}`)

    const post = await bridge.proxy(
      new Request("http://studio.test/api/session?location%5Bdirectory%5D=%2Fetc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Pinned", directory: "/copy-target", location: { directory: "/etc", workspace: "other" } }),
      }),
    )
    const postBody = await post.json()
    expect(postBody.locationDirectory).toBe("/srv/project")
    expect(postBody.headerDirectory).toBe(encodeURIComponent("/srv/project"))
    expect(postBody.body.location).toEqual({ directory: "/srv/project" })
    expect(postBody.body.directory).toBe("/copy-target")
    bridge.close()
  })

  test("does not add workspace query parameters to native UI assets", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        return Response.json({ search: new URL(request.url).search })
      },
    })
    servers.push(upstream)
    const bridge = createOpenCodeBridge({ baseUrl: `http://127.0.0.1:${upstream.port}`, workspace: "/srv/project" })
    const response = await bridge.proxy(new Request("http://studio.test/assets/index.js"))
    expect((await response.json()).search).toBe("")
    bridge.close()
  })

  test("removes stale compression headers from decompressed upstream responses", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch() {
        const body = Bun.gzipSync("compressed OpenCode asset")
        return new Response(body, {
          headers: { "Content-Encoding": "gzip", "Content-Length": String(body.byteLength), "Content-Type": "text/plain" },
        })
      },
    })
    servers.push(upstream)
    const bridge = createOpenCodeBridge({ baseUrl: `http://127.0.0.1:${upstream.port}`, workspace: "/srv/project" })
    const response = await bridge.proxy(new Request("http://studio.test/assets/index.js"))
    expect(response.headers.get("content-encoding")).toBeNull()
    expect(response.headers.get("content-length")).toBeNull()
    expect(await response.text()).toBe("compressed OpenCode asset")
    bridge.close()
  })

  test("pins WebSocket targets to the host workspace", async () => {
    const bridge = createOpenCodeBridge({ baseUrl: "http://127.0.0.1:4096", workspace: "/srv/project" })
    const target = new URL(await bridge.webSocketTarget("ws://studio.test/api/pty/one?directory=/etc&workspace=other"))
    expect(target.pathname).toBe("/api/pty/one")
    expect(target.searchParams.get("directory")).toBe("/srv/project")
    expect(target.searchParams.get("location[directory]")).toBe("/srv/project")
    expect(target.searchParams.has("workspace")).toBe(false)
    bridge.close()
  })

  test("proxies when attached to a parent OpenCode URL", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch() {
        return new Response("parent-ok")
      },
    })
    servers.push(upstream)
    const bridge = createOpenCodeBridge({
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      workspace: "/srv/project",
    })
    const response = await bridge.proxy(new Request("http://studio.test/"))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("parent-ok")
    const ws = new URL(await bridge.webSocketTarget("ws://studio.test/api/pty/one"))
    expect(ws.hostname).toBe("127.0.0.1")
    expect(ws.port).toBe(String(upstream.port))
    bridge.close()
  })
})
