import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { initializeStudio, type StudioLayout } from "../src/library"
import { createStudioApp, type StudioAppInput } from "../src/server"

async function makeLayout(): Promise<{ layout: StudioLayout; tmpRoot: string }> {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-studio-test-"))
  await mkdir(path.join(tmpRoot, "designs"), { recursive: true })
  const layout = await initializeStudio(tmpRoot)
  return { layout, tmpRoot }
}

async function makeDesign(layout: StudioLayout, id: string, built = false) {
  const dir = path.join(layout.designsRoot, id)
  await mkdir(path.join(dir, "parts"), { recursive: true })
  const designText = JSON.stringify({
    schema: 1,
    id,
    params: "params.py",
    parts: [{ id: "body", source: "parts/body.py" }],
  })
  await writeFile(path.join(dir, "design.json"), designText)
  await writeFile(path.join(dir, "params.py"), "SIZE = 10.0\n")
  if (built) {
    await mkdir(path.join(dir, "step"), { recursive: true })
    await mkdir(path.join(dir, "stl"), { recursive: true })
    await mkdir(path.join(dir, "glb"), { recursive: true })
    await writeFile(path.join(dir, "glb", "body.glb"), "fake-glb")
    await writeFile(path.join(dir, "step", "body.step"), "fake-step")
    await writeFile(path.join(dir, "stl", "body.stl"), "fake-stl")
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        schema: 1,
        id,
        parts: [
          {
            id: "body",
            files: {
              step: "step/body.step",
              stl: "stl/body.stl",
              glb: "glb/body.glb",
            },
            metrics: {
              volume_mm3: 1000,
              size_mm: { x: 10, y: 10, z: 10 },
              bounds_mm: { min: [-5, -5, 0], max: [5, 5, 10] },
              solid_count: 1,
            },
          },
        ],
        build: {
          engine: "forge-cad/1",
          inputs: { "design.json": createHash("sha256").update(designText).digest("hex") },
        },
      }),
    )
  }
  return dir
}

function appInput(layout: StudioLayout, overrides: Partial<StudioAppInput> = {}): StudioAppInput {
  return {
    layout,
    hostname: "127.0.0.1",
    port: 4173,
    studioId: "cad",
    packageVersion: "0.1.0",
    contractVersion: "1.0.0",
    ...overrides,
  }
}

function request(app: ReturnType<typeof createStudioApp>, pathName: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has("host")) headers.set("host", "127.0.0.1:4173")
  return app.request(pathName, { ...init, headers })
}

let tmpRoots: string[] = []

afterEach(async () => {
  for (const root of tmpRoots) {
    await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }))
  }
  tmpRoots = []
})

describe("createStudioApp", () => {
  let layout: StudioLayout

  beforeEach(async () => {
    const result = await makeLayout()
    layout = result.layout
    tmpRoots.push(result.tmpRoot)
  })

  test("GET /api/health returns ok with security headers", async () => {
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'")
  })

  test("GET /api/studio returns OSC identity", async () => {
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/studio")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: "cad",
      packageVersion: "0.1.0",
      contractVersion: "1.0.0",
    })
  })

  test("rejects invalid Host headers", async () => {
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/health", { headers: { host: "evil.example" } })
    expect(response.status).toBe(400)
  })

  test("GET /api/version reports only the running package version", async () => {
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/version")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: "0.1.0" })
  })

  test("GET /api/designs lists designs", async () => {
    await makeDesign(layout, "alpha")
    await makeDesign(layout, "beta")
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/designs")
    expect(response.status).toBe(200)
    const body = await response.json()
    const ids = body.designs.map((d: { id: string }) => d.id)
    expect(ids).toContain("alpha")
    expect(ids).toContain("beta")
    expect(body.designs[0].partCount).toBe(1)
    expect(body.designs[0].parts).toBeUndefined()
  })

  test("GET /api/designs marks a build stale when a hashed input changes", async () => {
    const designDir = await makeDesign(layout, "alpha", true)
    await writeFile(path.join(designDir, "design.json"), `${await Bun.file(path.join(designDir, "design.json")).text()}\n`)
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/designs")
    expect(response.status).toBe(200)
    expect((await response.json()).designs[0].buildStatus).toBe("stale")
  })

  test("GET /api/designs/:id returns design + null artifact when unbuilt", async () => {
    await makeDesign(layout, "alpha")
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/designs/alpha")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.design.id).toBe("alpha")
    expect(body.artifact).toBeNull()
  })

  test("GET /api/designs/:id returns artifact when built", async () => {
    await makeDesign(layout, "alpha", true)
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/designs/alpha")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.artifact.parts[0].id).toBe("body")
  })

  test("GET /api/designs/:id lists render PNGs", async () => {
    const designDir = await makeDesign(layout, "alpha", true)
    await mkdir(path.join(designDir, "renders"), { recursive: true })
    await writeFile(path.join(designDir, "renders", "body-iso.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(path.join(designDir, "renders", "ignored.txt"), "ignored")
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/designs/alpha")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.renders).toEqual(["body-iso.png"])
  })

  test("GET /api/designs/:id returns 404 for unknown design", async () => {
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/designs/nonexistent")
    expect(response.status).toBe(404)
  })

  test("GET /api/designs/:id rejects invalid id", async () => {
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/designs/UPPER")
    expect(response.status).toBe(400)
  })

  test("GET /api/artifact serves a glb file from manifest", async () => {
    await makeDesign(layout, "alpha", true)
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/artifact?design=alpha&file=glb/body.glb")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("model/gltf-binary")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toBe("fake-glb")
  })

  test("GET /api/artifact rejects file not in manifest", async () => {
    await makeDesign(layout, "alpha", true)
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/artifact?design=alpha&file=glb/other.glb")
    expect(response.status).toBe(404)
  })

  test("GET /api/artifact rejects path traversal", async () => {
    await makeDesign(layout, "alpha", true)
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/artifact?design=alpha&file=../../etc/passwd")
    expect(response.status).toBe(404)
  })

  test("GET /api/artifact returns 400 without design", async () => {
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/artifact?file=glb/body.glb")
    expect(response.status).toBe(400)
  })

  test("GET /api/artifact returns 404 for unbuilt design", async () => {
    await makeDesign(layout, "alpha", false)
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/artifact?design=alpha&file=glb/body.glb")
    expect(response.status).toBe(404)
  })

  test("GET /api/artifact rejects a manifest-listed symlink escaping the design", async () => {
    const designDir = await makeDesign(layout, "alpha", true)
    const outside = path.join(tmpRoots[0], "outside.glb")
    await writeFile(outside, "outside")
    await rm(path.join(designDir, "glb", "body.glb"))
    await symlink(outside, path.join(designDir, "glb", "body.glb"))
    const app = createStudioApp(appInput(layout))
    expect((await request(app, "/api/artifact?design=alpha&file=glb/body.glb")).status).toBe(400)
  })

  test("GET /api/render serves a validated PNG under renders/", async () => {
    const designDir = await makeDesign(layout, "alpha", true)
    await mkdir(path.join(designDir, "renders"), { recursive: true })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(path.join(designDir, "renders", "body-front.png"), png)
    const app = createStudioApp(appInput(layout))
    const response = await request(app, "/api/render?design=alpha&file=body-front.png")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })

  test("GET /api/render rejects traversal and unsupported filenames", async () => {
    await makeDesign(layout, "alpha", true)
    const app = createStudioApp(appInput(layout))
    expect((await request(app, "/api/render?design=alpha&file=../../secret.png")).status).toBe(400)
    expect((await request(app, "/api/render?design=alpha&file=body.svg")).status).toBe(400)
  })

  test("missing UI directory returns controlled 503", async () => {
    const app = createStudioApp(appInput(layout, { uiDirectory: path.join(tmpRoots[0], "missing-ui") }))
    expect((await request(app, "/")).status).toBe(503)
  })
})
