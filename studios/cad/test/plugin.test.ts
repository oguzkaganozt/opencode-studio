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
  stdout: "Build complete: /tmp/manifest.json",
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

async function makeStudio() {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-studio-plugin-"))
  await mkdir(path.join(tmpRoot, "designs"), { recursive: true })
  await mkdir(path.join(tmpRoot, "forge"), { recursive: true })
  const layout = await initializeStudio(tmpRoot)
  return { tmpRoot, layout }
}

const tmpRoots: string[] = []
afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }))
  }
})

describe("createStudioPlugin", () => {
  test("registers the expected tools", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin(fakeContext, {
      studioRoot: tmpRoot,
      forgeProjectDir: path.join(tmpRoot, "forge"),
      companionUrl: "http://127.0.0.1:4173",
    })
    expect(hooks.tool).toBeDefined()
    const toolNames = Object.keys(hooks.tool ?? {})
    expect(toolNames.sort()).toEqual(["design_build", "design_create", "design_list", "design_read", "design_view"].sort())
  })

  test("adds targeted guidance to build123d tool descriptions", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin(fakeContext, { studioRoot: tmpRoot })
    const cases = [
      ["build123d_execute", "named-object registry are separate"],
      ["build123d_import_cad_file", "is not bound as a Python variable"],
      ["build123d_compare", "global minimum between complete shapes"],
      ["build123d_analyze_printability", "current world orientation"],
    ] as const

    for (const [toolID, expected] of cases) {
      const output = { description: "Original.", parameters: {} }
      await hooks["tool.definition"]?.({ toolID }, output)
      expect(output.description).toContain(expected)
    }

    const fitOutput = { description: "Original.", parameters: {} }
    await hooks["tool.definition"]?.({ toolID: "build123d_compare" }, fitOutput)
    expect(fitOutput.description).toContain("not elastic accommodation")

    const unrelated = { description: "Unchanged.", parameters: {} }
    await hooks["tool.definition"]?.({ toolID: "build123d_measure" }, unrelated)
    expect(unrelated.description).toBe("Unchanged.")
  })

  test("design_create scaffolds a new design", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin(fakeContext, {
      studioRoot: tmpRoot,
      forgeProjectDir: path.join(tmpRoot, "forge"),
      companionUrl: "http://127.0.0.1:4173",
    })
    const createTool = (hooks.tool as any).design_create
    const result = await createTool.execute({ id: "test-design", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} })
    expect(result.title).toContain("test-design")
    expect(result.metadata.parts).toHaveLength(1)
    const listed = JSON.parse(await (hooks.tool as any).design_list.execute({}))
    expect(listed.designs[0].partCount).toBe(1)
    expect(listed.designs[0].parts).toBeUndefined()
    const placeholder = await readFile(path.join(tmpRoot, "designs", "test-design", "parts", "body.py"), "utf8")
    expect(placeholder).toContain("NotImplementedError")
    await expect(
      createTool.execute({ id: "test-design", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} }),
    ).rejects.toThrow(/already exists/)
  })

  test("design_list returns empty when designs/ is missing", async () => {
    const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-studio-plugin-fresh-"))
    tmpRoots.push(tmpRoot)
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin(fakeContext, {
      studioRoot: tmpRoot,
      forgeProjectDir: path.join(tmpRoot, "forge"),
      companionUrl: "http://127.0.0.1:4173",
    })
    const listTool = (hooks.tool as any).design_list
    const result = await listTool.execute({})
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ designs: [] })
  })

  test("design_view returns the configured design URL", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ status: "ok" }) })
    try {
      const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
      const hooks = await plugin(fakeContext, {
        studioRoot: tmpRoot,
        forgeProjectDir: path.join(tmpRoot, "forge"),
        companionUrl: server.url.origin,
      })
      await (hooks.tool as any).design_create.execute({ id: "demo", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} })
      const viewerTool = (hooks.tool as any).design_view
      const result = await viewerTool.execute({ id: "demo" })
      expect(result.metadata).toEqual({ url: `${server.url.origin}/designs/demo`, reachable: true })
      expect(result.metadata.designLoaded).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  test("design_build returns a concise artifact summary and design_read resolves artifacts and renders", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const runner = async ({ designDir }: { designDir: string }) => {
      await writeBuiltDesign(designDir, "demo")
      return { ok: true, exitCode: 0, stdout: "", stderr: "", manifestPath: null, designDir }
    }
    const plugin = createStudioPlugin({ forgeRunner: runner as any })
    const hooks = await plugin(fakeContext, { studioRoot: tmpRoot, forgeProjectDir: path.join(tmpRoot, "forge") })
    await (hooks.tool as any).design_create.execute({ id: "demo", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} })
    const renderPath = path.join(tmpRoot, "designs", "demo", "renders", "body-iso.png")
    await writeFile(renderPath, "png")

    const built = await (hooks.tool as any).design_build.execute({ id: "demo" }, { ...fakeContext, ask: async () => {} })
    const summary = JSON.parse(built.output)
    expect(summary.message).toBe("Build succeeded; design verification was not performed.")
    expect(path.isAbsolute(summary.manifestPath)).toBe(true)
    expect(path.isAbsolute(summary.parts[0].stepPath)).toBe(true)
    expect(summary.parts[0].metrics.solid_count).toBe(1)
    expect(summary.parts[0].files).toBeUndefined()
    expect(built.metadata).toEqual({
      ok: true,
      exitCode: 0,
      designDir: path.join(tmpRoot, "designs", "demo"),
      revision: summary.revision,
      manifestPath: summary.manifestPath,
    })

    const read = JSON.parse(await (hooks.tool as any).design_read.execute({ id: "demo" }))
    expect(read.buildStatus).toBe("built")
    expect(read.revision).toBe(summary.revision)
    expect(read.artifact.exists).toBe(true)
    expect(read.artifact.parts[0].files.step).toEqual({ path: summary.parts[0].stepPath, exists: true })
    expect(read.artifact.engine).toBe("forge-cad/1")
    expect(read.artifact.build).toBeUndefined()
    expect(read.renders).toEqual(["body-iso.png"])
    expect(read.verificationStatus).toBeUndefined()

    const listed = JSON.parse(await (hooks.tool as any).design_list.execute({}))
    expect(listed.designs[0].revision).toBe(summary.revision)
  })

  test("design_build requests only one-time artifact edit permission", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin(fakeContext, {
      studioRoot: tmpRoot,
      forgeProjectDir: path.join(tmpRoot, "forge"),
    })
    await (hooks.tool as any).design_create.execute({ id: "demo", parts: [{ id: "body" }] }, { ...fakeContext, ask: async () => {} })
    let permission: any
    await (hooks.tool as any).design_build.execute(
      { id: "demo" },
      {
        ...fakeContext,
        ask: async (input: any) => {
          permission = input
        },
      },
    )
    expect(permission.patterns).toEqual(["designs/demo/step/", "designs/demo/stl/", "designs/demo/glb/", "designs/demo/manifest.json"])
    expect(permission.always).toEqual([])
  })

  test("does not modify the system prompt", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin({ ...fakeContext, directory: tmpRoot }, { studioRoot: tmpRoot })
    expect(hooks["experimental.chat.system.transform"]).toBeUndefined()
  })

  test("resolves relative paths against the opencode project directory", async () => {
    const { tmpRoot } = await makeStudio()
    tmpRoots.push(tmpRoot)
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    const hooks = await plugin({ ...fakeContext, directory: tmpRoot }, { studioRoot: ".", forgeProjectDir: "forge" })
    expect(hooks.tool).toBeDefined()
  })

  test("rejects invalid path options", async () => {
    const plugin = createStudioPlugin({ forgeRunner: fakeForgeRunner as any })
    await expect(plugin(fakeContext, { studioRoot: "bad\0path" })).rejects.toThrow(/studioRoot/)
  })
})
