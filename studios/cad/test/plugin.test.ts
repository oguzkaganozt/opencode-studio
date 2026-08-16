import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { canonicalJson, contractHashOf, normalizeAcceptanceContract } from "../host/acceptance"
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

function acceptanceFixture() {
  return normalizeAcceptanceContract({
    schema: 1,
    state: "locked",
    authority: "harness",
    manufacturing: {
      process: "fdm",
      buildVolumeMm: [220, 220, 250],
      nozzleMm: 0.4,
      minimumWallMm: 1.2,
      bedToleranceMm: 0.1,
      defaultClearanceMm: 0.2,
    },
    dimensions: [
      { id: "body-x", kind: "bbox", artifactId: "body", measure: "size", axis: "X", targetMm: 100, toleranceMm: 5 },
      { id: "lid-x", kind: "bbox", artifactId: "lid", measure: "size", axis: "X", targetMm: 100, toleranceMm: 5 },
    ],
    interfaces: [{ id: "body-lid", a: "body", b: "lid", fit: "clearance", targetMm: 0.2, toleranceMm: 0.3 }],
  })
}

function acceptanceArg(parts?: Array<{ id: string; qty?: 1 | 2 }>) {
  const declared = new Set((parts ?? []).flatMap((part) => (part.qty === 2 ? [part.id, `${part.id}_mirror`] : [part.id])))
  const fixture = acceptanceFixture()
  return JSON.stringify({
    ...fixture,
    dimensions: fixture.dimensions.filter((dim) => declared.has(dim.artifactId)),
    interfaces: fixture.interfaces.filter((iface) => declared.has(iface.a) && declared.has(iface.b)),
  })
}

async function writeBuiltDesign(designDir: string, id: string, sizeMm = { x: 100, y: 70, z: 30 }) {
  for (const format of ["step", "stl", "glb"]) {
    await mkdir(path.join(designDir, format), { recursive: true })
    await writeFile(path.join(designDir, format, `body.${format}`), format)
    await writeFile(path.join(designDir, format, `lid.${format}`), format)
  }
  const inputs: Record<string, string> = {}
  for (const file of ["design.json", "params.py", "parts/body.py", "parts/lid.py", "ir/body.json", "ir/lid.json"]) {
    try {
      inputs[file] = createHash("sha256")
        .update(await readFile(path.join(designDir, file)))
        .digest("hex")
    } catch {
      // optional IR draft
    }
  }
  const parts = ["body", "lid"].map((partId) => ({
    id: partId,
    files: { step: `step/${partId}.step`, stl: `stl/${partId}.stl`, glb: `glb/${partId}.glb` },
    metrics: {
      volume_mm3: 1000,
      size_mm: sizeMm,
      bounds_mm: { min: [-50, -35, 0], max: [50, 35, 30] },
      solid_count: 1,
    },
  }))
  await writeFile(
    path.join(designDir, "manifest.json"),
    JSON.stringify({
      schema: 1,
      id,
      parts,
      build: { engine: "forge-cad/1", inputs },
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

  test("registers tools and scaffolds a locked design", async () => {
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
      "cad_design_qc_report",
      "cad_design_read",
      "cad_source_apply",
      "cad_print_plan_apply",
      "cad_verify",
      "cad_execute",
      "cad_validate",
      "cad_measure",
      "cad_compare",
      "cad_analyze_printability",
      "cad_analyze_form",
      "cad_render_view",
      "cad_reset",
    ]) {
      expect(names).toContain(name)
    }
    expect(names.filter((name) => name.startsWith("cad_")).length).toBe(17)
    expect(names).toContain("cad_ir_apply")
    expect(names).toContain("cad_ir_docs")
    expect(names).not.toContain("cad_design_join")
    expect(names).not.toContain("cad_design_dispatch")
    expect(names.some((name) => name.startsWith("design_") || name.startsWith("build123d_"))).toBe(false)
    const created = await (hooks.tool as any).cad_design_create.execute(
      { id: "test-design", parts: [{ id: "body", qty: 1 }], acceptance: acceptanceArg([{ id: "body", qty: 1 }]) },
      { ...fakeContext, ask: async () => {} },
    )
    expect(created.title).toContain("test-design")
    const createdBody = JSON.parse(created.output)
    expect(createdBody.ok).toBe(true)
    expect(createdBody.tool).toBe("cad_design_create")
    expect(createdBody.data.id).toBe("test-design")
    const listed = JSON.parse(await (hooks.tool as any).cad_design_read.execute({}))
    expect(listed.designs[0].partCount).toBe(1)
  })

  test("create rejects a bad contract and caps total qty", async () => {
    const studio = await makeStudio()
    const plugin = createStudioPlugin({ buildRunner: fakeCadBuildRunner as any })
    const hooks = await plugin(fakeContext, { studioRoot: studio.designsRoot, engineProjectDir: studio.engineDir })
    await expect(
      (hooks.tool as any).cad_design_create.execute(
        { id: "bad", parts: [{ id: "body", qty: 1 }], acceptance: JSON.stringify({ schema: 1, state: "open" }) },
        { ...fakeContext, ask: async () => {} },
      ),
    ).rejects.toThrow(/acceptance/)
    await expect(
      (hooks.tool as any).cad_design_create.execute(
        {
          id: "big",
          parts: Array.from({ length: 5 }, (_, index) => ({ id: `p${index}`, qty: 2 })),
          acceptance: acceptanceArg(),
        },
        { ...fakeContext, ask: async () => {} },
      ),
    ).rejects.toThrow(/qty/)
    // Contract refs must be declared parts.
    await expect(
      (hooks.tool as any).cad_design_create.execute(
        {
          id: "refs",
          parts: [{ id: "body", qty: 1 }],
          acceptance: JSON.stringify({
            ...acceptanceFixture(),
            dimensions: acceptanceFixture().dimensions.filter((dim) => dim.id === "lid-x"),
            interfaces: [],
          }),
        },
        { ...fakeContext, ask: async () => {} },
      ),
    ).rejects.toThrow(/unknown artifact/)
    await expect(
      (hooks.tool as any).cad_design_create.execute(
        {
          id: "refs2",
          parts: [{ id: "body", qty: 1 }],
          acceptance: JSON.stringify({
            ...acceptanceFixture(),
            dimensions: [],
            interfaces: acceptanceFixture().interfaces,
          }),
        },
        { ...fakeContext, ask: async () => {} },
      ),
    ).rejects.toThrow(/unknown artifact/)
  })

  test("acceptance is locked at create with a pinned contractHash", async () => {
    const studio = await makeStudio()
    const contract = acceptanceFixture()
    const expectedHash = contractHashOf(contract)
    const plugin = createStudioPlugin({ buildRunner: fakeCadBuildRunner as any })
    const hooks = await plugin(fakeContext, { studioRoot: studio.designsRoot, engineProjectDir: studio.engineDir })
    await (hooks.tool as any).cad_design_create.execute(
      {
        id: "locked",
        parts: [
          { id: "body", qty: 1 },
          { id: "lid", qty: 1 },
        ],
        acceptance: JSON.stringify(contract),
      },
      { ...fakeContext, ask: async () => {} },
    )
    const designDir = path.join(studio.designsRoot, "locked")
    const onDisk = JSON.parse(await readFile(path.join(designDir, "acceptance.json"), "utf8"))
    expect(onDisk.contractHash).toBe(expectedHash)
    expect(onDisk.state).toBe("locked")
    expect(await readFile(path.join(designDir, "acceptance", "history", `${expectedHash}.json`), "utf8")).toContain(expectedHash)
    const design = JSON.parse(await readFile(path.join(designDir, "design.json"), "utf8"))
    expect(design.schema).toBe(2)
    expect(design.acceptance).toBe("acceptance.json")
    expect(canonicalJson(contract)).toBe(canonicalJson(JSON.parse(JSON.stringify(contract))))
  })

  test("cad_ir_apply writes IR and cad_source_apply drops it", async () => {
    const studio = await makeStudio()
    const plugin = createStudioPlugin({ buildRunner: fakeCadBuildRunner as any })
    const hooks = await plugin(fakeContext, { studioRoot: studio.designsRoot, engineProjectDir: studio.engineDir })
    await (hooks.tool as any).cad_design_create.execute(
      { id: "ir-box", parts: [{ id: "body", qty: 1 }], acceptance: acceptanceArg([{ id: "body", qty: 1 }]) },
      { ...fakeContext, ask: async () => {} },
    )
    const read = JSON.parse(await (hooks.tool as any).cad_design_read.execute({ id: "ir-box" }, fakeContext))
    expect(read.ir.body.path).toBe("ir/body.json")
    expect(read.ir.body.stale).toBe(true)
    const docs = JSON.parse(await (hooks.tool as any).cad_ir_docs.execute({}))
    expect(docs.ops.length).toBeGreaterThan(0)
    const applied = JSON.parse(
      (
        await (hooks.tool as any).cad_ir_apply.execute(
          {
            id: "ir-box",
            part: "body",
            base_hash: read.ir.body.hash,
            document: {
              schema: 1,
              part: "body",
              params: [],
              ops: [{ op: "primitive", id: "box", kind: "box", size: [100, 70, 30] }],
              show: "box",
            },
          },
          { ...fakeContext, ask: async () => {} },
        )
      ).output,
    )
    expect(applied.ok).toBe(true)
    const after = JSON.parse(await (hooks.tool as any).cad_design_read.execute({ id: "ir-box" }, fakeContext))
    expect(after.design.parts[0].ir).toBe("ir/body.json")
    const escaped = JSON.parse(
      (
        await (hooks.tool as any).cad_source_apply.execute(
          {
            id: "ir-box",
            part: "body",
            path: "parts/body.py",
            contents: "def build():\n    raise NotImplementedError('hand')\n",
            base_hash: after.sources["parts/body.py"],
          },
          { ...fakeContext, ask: async () => {} },
        )
      ).output,
    )
    expect(escaped.ok).toBe(true)
    const hand = JSON.parse(await (hooks.tool as any).cad_design_read.execute({ id: "ir-box" }, fakeContext))
    expect(hand.design.parts[0].ir).toBeUndefined()
  })

  test("qc report is claim-free and blocked without evidence", async () => {
    const studio = await makeStudio()
    const runner = async ({ designDir }: { designDir: string }) => {
      await writeBuiltDesign(designDir, "demo")
      return { ok: true, exitCode: 0, stdout: "", stderr: "", manifestPath: null, designDir }
    }
    const plugin = createStudioPlugin({ buildRunner: runner as any })
    const hooks = await plugin(fakeContext, { studioRoot: studio.designsRoot, engineProjectDir: studio.engineDir })
    await (hooks.tool as any).cad_design_create.execute(
      {
        id: "demo",
        parts: [
          { id: "body", qty: 1 },
          { id: "lid", qty: 1 },
        ],
        acceptance: acceptanceArg([
          { id: "body", qty: 1 },
          { id: "lid", qty: 1 },
        ]),
      },
      { ...fakeContext, ask: async () => {} },
    )
    const built = await (hooks.tool as any).cad_design_build.execute({ id: "demo" }, { ...fakeContext, ask: async () => {} })
    const builtBody = JSON.parse(built.output)
    expect(builtBody.ok).toBe(true)
    expect(builtBody.data.parts[0].bodyHash).toBeNull()
    expect(builtBody.warnings.join(" ")).toMatch(/not run/i)

    // Claim-free: agent cannot pass statuses; bare report is blocked.
    const incomplete = JSON.parse((await (hooks.tool as any).cad_design_qc_report.execute({ id: "demo" }, fakeContext)).output)
    expect(incomplete.complete).toBe(false)
    expect(incomplete.artifact.status).toBe("pass")
    expect(incomplete.blockedBy).toEqual(expect.arrayContaining(["requirements", "manufacturing", "interfaces"]))

    // Forged claims are impossible: the tool has no status fields.
    const tool = (hooks.tool as any).cad_design_qc_report
    expect(tool.args).not.toHaveProperty("printability")
    expect(tool.args).not.toHaveProperty("fit")
    expect(tool.args).not.toHaveProperty("form")
  })

  test("stale evidence and missing print plan keep the report blocked", async () => {
    const studio = await makeStudio()
    const plugin = createStudioPlugin({ buildRunner: fakeCadBuildRunner as any })
    const hooks = await plugin(fakeContext, { studioRoot: studio.designsRoot, engineProjectDir: studio.engineDir })
    await (hooks.tool as any).cad_design_create.execute(
      { id: "stale", parts: [{ id: "body", qty: 1 }], acceptance: acceptanceArg([{ id: "body", qty: 1 }]) },
      { ...fakeContext, ask: async () => {} },
    )
    // Evidence written under an old revision must be ignored.
    const designDir = path.join(studio.designsRoot, "stale")
    await mkdir(path.join(designDir, "evidence", "records"), { recursive: true })
    await writeFile(
      path.join(designDir, "evidence", "records", "req-body-x.json"),
      JSON.stringify({
        schema: 1,
        id: "req-body-x",
        axis: "requirement",
        buildRevision: "deadbeef",
        contractHash: "c".repeat(64),
        subjects: ["body"],
        requirementId: "body-x",
        status: "pass",
        findings: [],
        recordedAt: Date.now(),
      }),
    )
    // No build exists; report must stay blocked regardless of the forged record.
    const report = JSON.parse((await (hooks.tool as any).cad_design_qc_report.execute({ id: "stale" }, fakeContext)).output)
    expect(report.complete).toBe(false)
    expect(report.blockedBy).toContain("artifact")
  })
})
