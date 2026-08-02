import { afterEach, describe, expect, test } from "bun:test"
import { createOpenCodeBridge, normalizeParentOpenCodeUrl, resolveBridgeDirectory } from "../src/opencode-bridge"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("OpenCode bridge", () => {
  test("normalizes bind-any parent hosts to loopback", () => {
    expect(normalizeParentOpenCodeUrl("http://0.0.0.0:4096")).toBe("http://127.0.0.1:4096")
    expect(normalizeParentOpenCodeUrl("http://127.0.0.1:4096/")).toBe("http://127.0.0.1:4096")
  })

  test("resolveBridgeDirectory prefers client absolute directory over fallback", () => {
    const req = new Request("http://studio.test/session?directory=%2Fhome%2Fproj")
    expect(resolveBridgeDirectory(req, "/fallback")).toBe("/home/proj")
    const headerReq = new Request("http://studio.test/session", {
      headers: { "x-opencode-directory": encodeURIComponent("/srv/other") },
    })
    expect(resolveBridgeDirectory(headerReq, "/fallback")).toBe("/srv/other")
    expect(resolveBridgeDirectory(new Request("http://studio.test/session"), "/fallback")).toBe("/fallback")
  })

  test("uses client directory when present; falls back to fixed Studio Home", async () => {
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
      studioRoot: "/srv/studio-home",
      env: { OPENCODE_SERVER_PASSWORD: "parent-secret" },
    })

    const withClient = await bridge.proxy(
      new Request("http://studio.test/session?directory=%2Fhome%2Factive", {
        headers: { authorization: "Basic browser-credential" },
      }),
    )
    const clientBody = await withClient.json()
    expect(clientBody.directory).toBe("/home/active")
    expect(clientBody.locationDirectory).toBe("/home/active")
    expect(clientBody.authorization).toBe(`Basic ${Buffer.from("opencode:parent-secret").toString("base64")}`)

    const fallback = await bridge.proxy(new Request("http://studio.test/session"))
    const fallbackBody = await fallback.json()
    expect(fallbackBody.directory).toBe("/srv/studio-home")

    const post = await bridge.proxy(
      new Request("http://studio.test/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Keep", location: { directory: "/home/from-body" } }),
      }),
    )
    const postBody = await post.json()
    expect(postBody.body.location).toEqual({ directory: "/home/from-body" })
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
    const bridge = createOpenCodeBridge({ baseUrl: `http://127.0.0.1:${upstream.port}`, studioRoot: "/srv/studio-home" })
    const response = await bridge.proxy(new Request("http://studio.test/assets/index.js"))
    expect((await response.json()).search).toBe("")
    bridge.close()
  })
})
