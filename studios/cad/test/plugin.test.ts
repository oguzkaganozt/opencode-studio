import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { initializeStudio } from "../library"
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

const fakeForgeRunner = async () => ({
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
  await mkdir(path.join(tmpRoot, "designs"), { recursive: true })
  await mkdir(path.join(tmpRoot, "forge"), { recursive: true })
  await initializeStudio(tmpRoot)
  return tmpRoot
}

describe("cad plugin smoke", () => {
  test("registers tools and scaffolds a design", async () => {
    const tmpRoot = await makeStudio()
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin(fakeContext, {
      studioRoot: tmpRoot,
      forgeProjectDir: path.join(tmpRoot, "forge"),
      companionUrl: "http://127.0.0.1:4173",
    })
    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual(
      ["design_build", "design_create", "design_list", "design_qc_report", "design_read", "design_view"].sort(),
    )
    const created = await (hooks.tool as any).design_create.execute(
      { id: "test-design", parts: [{ id: "body" }] },
      { ...fakeContext, ask: async () => {} },
    )
    expect(created.title).toContain("test-design")
    const listed = JSON.parse(await (hooks.tool as any).design_list.execute({}))
    expect(listed.designs[0].partCount).toBe(1)
  })

  test("build + qc report reflect artifact and axis honesty", async () => {
    const tmpRoot = await makeStudio()
    const runner = async ({ designDir }: { designDir: string }) => {
      await writeBuiltDesign(designDir, "demo")
      return { ok: true, exitCode: 0, stdout: "", stderr: "", manifestPath: null, designDir }
    }
    const plugin = createStudioPlugin({ forgeRunner: runner as any })
    const hooks = await plugin(fakeContext, { studioRoot: tmpRoot, forgeProjectDir: path.join(tmpRoot, "forge") })
    await (hooks.tool as any).design_create.execute({ id: "demo", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} })
    const built = await (hooks.tool as any).design_build.execute({ id: "demo" }, { ...fakeContext, ask: async () => {} })
    expect(JSON.parse(built.output).parts[0].metrics.solid_count).toBe(1)

    const incomplete = JSON.parse((await (hooks.tool as any).design_qc_report.execute({ id: "demo" })).output)
    expect(incomplete.complete).toBe(false)
    expect(incomplete.artifact.status).toBe("pass")
    expect(incomplete.blockedBy).toEqual(expect.arrayContaining(["printability", "fit", "form"]))

    const complete = JSON.parse(
      (
        await (hooks.tool as any).design_qc_report.execute({
          id: "demo",
          printability: { status: "pass", findings: [] },
          fit: { status: "pass", findings: ["ok"] },
          form: { status: "pass", findings: ["ok"] },
        })
      ).output,
    )
    expect(complete.complete).toBe(true)
  })
})
