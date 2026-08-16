import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { type BenchFixtureV1, scoreBench, scoreCadBenchOnDisk } from "../../../scripts/bench"
import { contractHashOf, normalizeAcceptanceContract } from "../host/acceptance"

const SIZE = { x: 100, y: 70, z: 30 }
const CONTRACT = normalizeAcceptanceContract({
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
const HASH = contractHashOf(CONTRACT)

const FIXTURE: BenchFixtureV1 = {
  schema: 1,
  expectedDesignId: "box-v0",
  expectedParts: [
    { id: "body", qty: 1 },
    { id: "lid", qty: 1 },
  ],
  pinnedContractHash: HASH,
  wallTimeMs: 60_000,
}

const tmpRoots: string[] = []
afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function makeStudio(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "cad-bench-"))
  tmpRoots.push(root)
  const designDir = path.join(root, "studio", "designs", "box-v0")
  await mkdir(path.join(designDir, "parts"), { recursive: true })
  await mkdir(path.join(designDir, "step"), { recursive: true })
  await mkdir(path.join(designDir, "stl"), { recursive: true })
  await mkdir(path.join(designDir, "glb"), { recursive: true })
  await mkdir(path.join(designDir, "evidence", "records"), { recursive: true })
  await writeFile(
    path.join(designDir, "design.json"),
    JSON.stringify({
      schema: 2,
      id: "box-v0",
      params: "params.py",
      acceptance: "acceptance.json",
      parts: [
        { id: "body", qty: 1, source: "parts/body.py" },
        { id: "lid", qty: 1, source: "parts/lid.py" },
      ],
    }),
  )
  await writeFile(path.join(designDir, "acceptance.json"), JSON.stringify({ ...CONTRACT, contractHash: HASH }, null, 2))
  await writeFile(path.join(designDir, "params.py"), "SIZE = 10\n")
  for (const partId of ["body", "lid"]) {
    await writeFile(path.join(designDir, "parts", `${partId}.py`), "def build():\n    pass\n")
    await writeFile(path.join(designDir, "step", `${partId}.step`), "step-bytes")
    await writeFile(path.join(designDir, "stl", `${partId}.stl`), "stl-bytes")
    await writeFile(path.join(designDir, "glb", `${partId}.glb`), "glb-bytes")
  }
  return root
}

async function writeManifest(designDir: string) {
  const inputs: Record<string, string> = {}
  for (const file of ["design.json", "params.py", "parts/body.py", "parts/lid.py"]) {
    const { createHash } = await import("node:crypto")
    inputs[file] = createHash("sha256")
      .update(await readFile(path.join(designDir, file)))
      .digest("hex")
  }
  const manifestText = `${JSON.stringify({
    schema: 1,
    id: "box-v0",
    parts: ["body", "lid"].map((partId) => ({
      id: partId,
      files: { step: `step/${partId}.step`, stl: `stl/${partId}.stl`, glb: `glb/${partId}.glb` },
      metrics: { volume_mm3: 1000, size_mm: SIZE, bounds_mm: { min: [-50, -35, 0], max: [50, 35, 30] }, solid_count: 1 },
    })),
    build: { engine: "forge-cad/1", inputs },
  })}\n`
  await writeFile(path.join(designDir, "manifest.json"), manifestText)
  // Mirror the build into a generation dir so ensurePublicArtifactLinks can
  // repoint the public step/stl/glb links at it (production layout).
  const { createHash } = await import("node:crypto")
  const gen = createHash("sha256").update(manifestText).digest("hex")
  const generation = path.join(designDir, ".artifacts", gen)
  for (const format of ["step", "stl", "glb"]) {
    await mkdir(path.join(generation, format), { recursive: true })
    for (const partId of ["body", "lid"]) {
      await writeFile(path.join(generation, format, `${partId}.${format}`), `${format}-bytes`)
    }
  }
  await writeFile(path.join(generation, "manifest.json"), manifestText)
  await mkdir(path.join(designDir, ".artifacts"), { recursive: true })
  await symlink(gen, path.join(designDir, ".artifacts", "current")).catch(() => {})
}

function record(designDir: string, id: string, over: Record<string, unknown> = {}) {
  return writeFile(
    path.join(designDir, "evidence", "records", `${id}.json`),
    JSON.stringify({
      schema: 1,
      id,
      axis: "requirement",
      buildRevision: "REV",
      contractHash: HASH,
      subjects: [],
      status: "pass",
      findings: [],
      recordedAt: Date.now(),
      ...over,
    }),
  )
}

async function currentRevision(designDir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(designDir, "manifest.json"), "utf8")) as {
    build: { engine: string; inputs: Record<string, string> }
  }
  const { createHash } = await import("node:crypto")
  const inputs = Object.entries(manifest.build.inputs).sort(([a], [b]) => a.localeCompare(b))
  return createHash("sha256")
    .update(JSON.stringify([manifest.build.engine, inputs]))
    .digest("hex")
}

async function writeFullEvidence(designDir: string) {
  const rev = await currentRevision(designDir)
  await record(designDir, "req-body-x", { axis: "requirement", requirementId: "body-x", subjects: ["body"], buildRevision: rev })
  await record(designDir, "req-lid-x", { axis: "requirement", requirementId: "lid-x", subjects: ["lid"], buildRevision: rev })
  await record(designDir, "print-body", { axis: "printability", subjects: ["body"], buildRevision: rev })
  await record(designDir, "print-lid", { axis: "printability", subjects: ["lid"], buildRevision: rev })
  await record(designDir, "fit-body-lid", {
    axis: "interface",
    interfaceId: "body-lid",
    subjects: ["body", "lid"],
    buildRevision: rev,
  })
}

async function writePrintPlan(designDir: string) {
  const rev = await currentRevision(designDir)
  await writeFile(
    path.join(designDir, "print-plan.json"),
    JSON.stringify({
      schema: 1,
      buildRevision: rev,
      entries: [
        {
          artifactId: "body",
          bodyHash: "x",
          rotateDeg: [0, 0, 0],
          translateMm: [0, 0, 0],
          boundsMm: { min: [-50, -35, 0], max: [50, 35, 30] },
        },
        {
          artifactId: "lid",
          bodyHash: "x",
          rotateDeg: [0, 0, 0],
          translateMm: [0, 0, 0],
          boundsMm: { min: [-50, -35, 0], max: [50, 35, 10] },
        },
      ],
    }),
  )
}

describe("cad bench disk scorer", () => {
  test("passes a fully complete design on disk", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    await writePrintPlan(designDir)
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: false })
    expect(scored.ok).toBe(true)
    for (const [key, value] of Object.entries(scored.checks)) {
      expect(value, key).toBe(true)
    }
  })

  test("forged complete claim in events is irrelevant: disk evidence decides", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    await writePrintPlan(designDir)
    // A forged `complete: true` qc_report event must not change the score:
    // the scorer recomputes QC from disk and ignores tool-call claims.
    const forged = [
      {
        type: "tool_use",
        timestamp: Date.now(),
        part: { type: "tool", tool: "cad_design_qc_report", state: { output: JSON.stringify({ complete: true }) } },
      },
    ]
    const scored = await scoreBench({
      studio: "cad",
      events: forged as any,
      studioHome: root,
      fixture: FIXTURE,
      wallTimeExceeded: false,
    })
    expect(scored.ok).toBe(true)

    // And a forged claim cannot rescue an incomplete disk state.
    const broken = await makeStudio()
    const scoredBroken = await scoreBench({
      studio: "cad",
      events: forged as any,
      studioHome: broken,
      fixture: FIXTURE,
      wallTimeExceeded: false,
    })
    expect(scoredBroken.ok).toBe(false)
    void designDir
  })

  test("missing interface fails (one fit cannot pass a two-interface design)", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    // Drop the fit record.
    await rm(path.join(designDir, "evidence", "records", "fit-body-lid.json"))
    await writePrintPlan(designDir)
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: false })
    expect(scored.ok).toBe(false)
    expect(scored.checks.interfaces_pass).toBe(false)
  })

  test("stale evidence fails (records bound to an older build revision)", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    const rev = await currentRevision(designDir)
    for (const file of ["req-body-x", "req-lid-x", "print-body", "print-lid", "fit-body-lid"]) {
      const raw = JSON.parse(await readFile(path.join(designDir, "evidence", "records", `${file}.json`), "utf8"))
      raw.buildRevision = `${rev}STALE`
      await writeFile(path.join(designDir, "evidence", "records", `${file}.json`), JSON.stringify(raw))
    }
    await writePrintPlan(designDir)
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: false })
    expect(scored.ok).toBe(false)
    expect(scored.checks.requirements_pass).toBe(false)
  })

  test("missing print plan fails", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: false })
    expect(scored.ok).toBe(false)
    expect(scored.checks.print_plan).toBe(false)
  })

  test("warning-only printability fails via the findings axis", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    const rev = await currentRevision(designDir)
    await record(designDir, "print-body", {
      axis: "printability",
      subjects: ["body"],
      buildRevision: rev,
      findings: [{ severity: "warning", message: "thin wall 0.9mm on body" }],
    })
    await writePrintPlan(designDir)
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: false })
    expect(scored.ok).toBe(false)
    expect(scored.checks.no_unresolved_findings).toBe(false)
  })

  test("wrong contract hash fails", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    await writePrintPlan(designDir)
    const acceptancePath = path.join(designDir, "acceptance.json")
    const raw = JSON.parse(await readFile(acceptancePath, "utf8"))
    raw.contractHash = "f".repeat(64)
    await writeFile(acceptancePath, JSON.stringify(raw))
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: false })
    expect(scored.ok).toBe(false)
    expect(scored.checks.locked_contract).toBe(false)
  })

  test("wall time exceeded fails", async () => {
    const root = await makeStudio()
    const designDir = path.join(root, "studio", "designs", "box-v0")
    await writeManifest(designDir)
    await writeFullEvidence(designDir)
    await writePrintPlan(designDir)
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: true })
    expect(scored.ok).toBe(false)
    expect(scored.checks.wall_time).toBe(false)
  })

  test("missing expected design fails", async () => {
    const root = await makeStudio()
    await rm(path.join(root, "studio", "designs", "box-v0"), { recursive: true, force: true })
    const scored = await scoreCadBenchOnDisk({ studioHome: root, fixture: FIXTURE, wallTimeExceeded: false })
    expect(scored.ok).toBe(false)
    expect(scored.checks.design_exists).toBe(false)
  })
})
