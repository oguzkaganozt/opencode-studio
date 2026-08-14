import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createCadApi } from "../host/api"
import { initializeStudio } from "../host/library"
import { createStudioPlugin } from "../tools"

const fakeContext = {
  directory: "",
  worktree: "",
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
} as any

const fakeCadBuildRunner = async () => ({
  ok: true,
  exitCode: 0,
  stdout: "Build complete",
  stderr: "",
  manifestPath: null,
  designDir: "/tmp/design",
})

async function writeBuiltDesign(designDir: string, id: string) {
  for (const format of ["step", "stl", "glb"]) {
    await mkdir(path.join(designDir, format), { recursive: true })
    await writeFile(path.join(designDir, format, `body.${format}`), format)
  }
  const designText = await readFile(path.join(designDir, "design.json"), "utf8")
  await writeFile(
    path.join(designDir, "manifest.json"),
    JSON.stringify({
      schema: 1,
      id,
      parts: [
        {
          id: "body",
          files: { step: "step/body.step", stl: "stl/body.stl", glb: "glb/body.glb" },
          metrics: {
            volume_mm3: 1000,
            size_mm: { x: 10, y: 10, z: 10 },
            bounds_mm: { min: [-5, -5, 0], max: [5, 5, 10] },
            solid_count: 1,
          },
        },
      ],
      build: { engine: "forge-cad/1", inputs: { "design.json": createHash("sha256").update(designText).digest("hex") } },
    }),
  )
}

const tmpRoots: string[] = []
afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }))
  }
})

async function makeStudio() {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-studio-plugin-"))
  tmpRoots.push(tmpRoot)
  const designsRoot = path.join(tmpRoot, "designs")
  await mkdir(designsRoot, { recursive: true })
  await mkdir(path.join(tmpRoot, "engine"), { recursive: true })
  await initializeStudio(designsRoot)
  return { designsRoot, engineDir: path.join(tmpRoot, "engine") }
}

describe("cad plugin smoke", () => {
  test("resolves the expected directory for a missing design", async () => {
    const studio = await makeStudio()
    const app = createCadApi(await initializeStudio(studio.designsRoot))

    const response = await app.request("/workspace?designId=missing-design")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      root: studio.designsRoot,
      path: "missing-design",
      directory: path.join(studio.designsRoot, "missing-design"),
    })
  })

  test("registers tools and scaffolds a design", async () => {
    const studio = await makeStudio()
    const plugin = createStudioPlugin({ buildRunner: fakeCadBuildRunner as any })
    const hooks = await plugin(fakeContext, {
      studioRoot: studio.designsRoot,
      engineProjectDir: studio.engineDir,
      companionUrl: "http://127.0.0.1:4173",
    })
    const names = Object.keys(hooks.tool ?? {}).sort()
    for (const name of [
      "cad_design_build",
      "cad_design_create",
      "cad_design_list",
      "cad_design_qc_report",
      "cad_design_read",
      "cad_design_view",
      "cad_design_dispatch",
      "cad_design_join",
    ]) {
      expect(names).toContain(name)
    }
    expect(names.filter((name) => name.startsWith("cad_")).length).toBeGreaterThan(30)
    expect(names).toContain("cad_execute")
    expect(names).toContain("cad_measure")
    expect(names.some((name) => name.startsWith("design_") || name.startsWith("build123d_"))).toBe(false)
    const created = await (hooks.tool as any).cad_design_create.execute(
      { id: "test-design", parts: [{ id: "body" }] },
      { ...fakeContext, ask: async () => {} },
    )
    expect(created.title).toContain("test-design")
    const createdBody = JSON.parse(created.output)
    expect(createdBody.ok).toBe(true)
    expect(createdBody.tool).toBe("cad_design_create")
    expect(createdBody.data.id).toBe("test-design")
    expect(createdBody.next?.length).toBeGreaterThan(0)
    const listed = JSON.parse(await (hooks.tool as any).cad_design_list.execute({}))
    expect(listed.designs[0].partCount).toBe(1)
  })

  test("dispatch stays serial for one part and joins stub sources", async () => {
    const studio = await makeStudio()
    const spawned: string[] = []
    const plugin = createStudioPlugin({
      buildRunner: fakeCadBuildRunner as any,
      dispatcher: {
        async spawn(input) {
          spawned.push(input.partId)
          return { sessionID: `ses-${input.partId}` }
        },
      },
    })
    const hooks = await plugin(fakeContext, { studioRoot: studio.designsRoot, engineProjectDir: studio.engineDir })
    await (hooks.tool as any).cad_design_create.execute({ id: "one", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} })
    const serial = JSON.parse(await (hooks.tool as any).cad_design_dispatch.execute({ id: "one" }, fakeContext))
    expect(serial.mode).toBe("serial")
    expect(spawned).toEqual([])

    const created = await (hooks.tool as any).cad_design_create.execute(
      {
        id: "two",
        parts: [{ id: "body" }, { id: "lid" }],
        params: "BOX_L = 100\n",
        brief: "Desk box with press-fit lid.",
      },
      { ...fakeContext, ask: async () => {} },
    )
    const createdBody = JSON.parse(created.output)
    expect(createdBody.data.dispatch.mode).toBe("parallel")
    expect(spawned).toEqual(["body", "lid"])
    const again = JSON.parse(await (hooks.tool as any).cad_design_dispatch.execute({ id: "two" }, fakeContext))
    expect(again.mode).toBe("parallel")
    expect(spawned).toEqual(["body", "lid"])
    const joined = JSON.parse(await (hooks.tool as any).cad_design_join.execute({ id: "two" }, fakeContext))
    expect(joined.ok).toBe(false)
    expect(joined.pending.sort()).toEqual(["body", "lid"])
  })

  test("build + qc report reflect artifact and axis honesty", async () => {
    const studio = await makeStudio()
    const runner = async ({ designDir }: { designDir: string }) => {
      await writeBuiltDesign(designDir, "demo")
      return { ok: true, exitCode: 0, stdout: "", stderr: "", manifestPath: null, designDir }
    }
    const plugin = createStudioPlugin({ buildRunner: runner as any })
    const hooks = await plugin(fakeContext, { studioRoot: studio.designsRoot, engineProjectDir: studio.engineDir })
    await (hooks.tool as any).cad_design_create.execute({ id: "demo", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} })
    const built = await (hooks.tool as any).cad_design_build.execute({ id: "demo" }, { ...fakeContext, ask: async () => {} })
    const builtBody = JSON.parse(built.output)
    expect(builtBody.ok).toBe(true)
    expect(builtBody.tool).toBe("cad_design_build")
    expect(builtBody.data.parts[0].metrics.solid_count).toBe(1)
    expect(builtBody.warnings.join(" ")).toMatch(/not run/i)

    const incomplete = JSON.parse((await (hooks.tool as any).cad_design_qc_report.execute({ id: "demo" }, fakeContext)).output)
    expect(incomplete.complete).toBe(false)
    expect(incomplete.artifact.status).toBe("pass")
    expect(incomplete.blockedBy).toEqual(expect.arrayContaining(["printability", "fit", "form"]))

    // Bare pass without session evidence must not complete.
    const forged = JSON.parse(
      (
        await (hooks.tool as any).cad_design_qc_report.execute(
          {
            id: "demo",
            printability: { status: "pass", findings: [] },
            fit: { status: "pass", findings: ["ok"] },
            form: { status: "pass", findings: ["not applicable"] },
          },
          fakeContext,
        )
      ).output,
    )
    expect(forged.complete).toBe(false)
    expect(forged.printability.status).toBe("unverified")
    expect(forged.fit.status).toBe("unverified")
    expect(forged.form.status).toBe("pass")
    expect(forged.printability.source).toBe("rejected")
  })
})
