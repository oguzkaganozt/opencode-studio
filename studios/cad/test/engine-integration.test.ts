import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildDesign } from "../host/build"
import { initializeStudio } from "../host/library"

const ENGINE_PROJECT_DIR = path.resolve(import.meta.dir, "..", "engine")
const ENGINE_TIMEOUT_MS = 90_000

const tmpRoots: string[] = []
afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function makeDesign(designsRoot: string, id: string, schema: 1 | 2 = 2): Promise<string> {
  const designDir = path.join(designsRoot, id)
  await mkdir(path.join(designDir, "parts"), { recursive: true })
  const manifest: Record<string, unknown> =
    schema === 2
      ? { schema: 2, id, params: "params.py", acceptance: "acceptance.json", parts: [{ id: "cube", source: "parts/cube.py" }] }
      : { schema: 1, id, params: "params.py", parts: [{ id: "cube", source: "parts/cube.py" }] }
  await writeFile(path.join(designDir, "design.json"), JSON.stringify(manifest))
  if (schema === 2) {
    await writeFile(
      path.join(designDir, "acceptance.json"),
      JSON.stringify({
        schema: 1,
        state: "locked",
        authority: "harness",
        contractHash: "0".repeat(64),
        manufacturing: {
          process: "fdm",
          buildVolumeMm: [220, 220, 250],
          nozzleMm: 0.4,
          minimumWallMm: 1.2,
          bedToleranceMm: 0.1,
          defaultClearanceMm: 0.2,
        },
        dimensions: [],
        interfaces: [],
      }),
    )
  }
  await writeFile(path.join(designDir, "params.py"), "SIZE = 12.0\nEPS = 0.01\n")
  await writeFile(
    path.join(designDir, "parts", "cube.py"),
    "from build123d import Box\nfrom params import SIZE\n\ndef build():\n    return Box(SIZE, SIZE, SIZE)\n",
  )
  return designDir
}

describe("design_build integration (real subprocess)", () => {
  test(
    "builds a design via uv --project subprocess and writes STEP/STL/GLB + manifest",
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-engine-int-"))
      tmpRoots.push(tmpRoot)
      await makeDesign(tmpRoot, "cube-test")

      const layout = await initializeStudio(tmpRoot)
      const result = await buildDesign(layout, "cube-test", ENGINE_PROJECT_DIR)

      expect(result.ok).toBe(true)
      expect(result.exitCode).toBe(0)

      const designDir = path.join(tmpRoot, "cube-test")
      const manifestText = await readFile(path.join(designDir, "manifest.json"), "utf8")
      const manifest = JSON.parse(manifestText)
      expect(manifest.id).toBe("cube-test")
      expect(manifest.parts).toHaveLength(1)
      const part = manifest.parts[0]
      expect(part.id).toBe("cube")
      expect(part.metrics.volume_mm3).toBe(1728.0)
      expect(part.files.step).toBe("step/cube.step")
      expect(part.files.stl).toBe("stl/cube.stl")
      expect(part.files.glb).toBe("glb/cube.glb")

      for (const file of ["step/cube.step", "stl/cube.stl", "glb/cube.glb"]) {
        const info = await stat(path.join(designDir, file))
        expect(info.size).toBeGreaterThan(0)
      }
      expect(part.body_hash).toMatch(/^[a-f0-9]{64}$/)
    },
    ENGINE_TIMEOUT_MS + 10_000,
  )

  test(
    "schema 1 design still builds",
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-engine-schema1-"))
      tmpRoots.push(tmpRoot)
      await makeDesign(tmpRoot, "cube-schema1", 1)

      const layout = await initializeStudio(tmpRoot)
      const result = await buildDesign(layout, "cube-schema1", ENGINE_PROJECT_DIR)
      expect(result.ok).toBe(true)
      const designDir = path.join(tmpRoot, "cube-schema1")
      const manifest = JSON.parse(await readFile(path.join(designDir, "manifest.json"), "utf8"))
      expect(manifest.id).toBe("cube-schema1")
    },
    ENGINE_TIMEOUT_MS + 10_000,
  )

  test(
    "aborted build cannot publish",
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-engine-abort-"))
      tmpRoots.push(tmpRoot)
      await makeDesign(tmpRoot, "abort-test")
      const designDir = path.join(tmpRoot, "abort-test")
      // Slow source so the abort lands mid-build.
      await writeFile(
        path.join(designDir, "parts", "cube.py"),
        "import time\nfrom build123d import Box\nfrom params import SIZE\n\ndef build():\n    time.sleep(30)\n    return Box(SIZE, SIZE, SIZE)\n",
      )

      const layout = await initializeStudio(tmpRoot)
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 1_000)
      const result = await buildDesign(layout, "abort-test", ENGINE_PROJECT_DIR, undefined, controller.signal)
      expect(result.ok).toBe(false)
      expect(result.exitCode).toBe(130)
      expect(result.manifestPath).toBeNull()
      expect(await Bun.file(path.join(designDir, "manifest.json")).exists()).toBe(false)
    },
    ENGINE_TIMEOUT_MS + 10_000,
  )

  test(
    "failed build preserves previous output (subprocess)",
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-engine-preserve-"))
      tmpRoots.push(tmpRoot)
      const designDir = await makeDesign(tmpRoot, "preserve-test")

      const layout = await initializeStudio(tmpRoot)
      const first = await buildDesign(layout, "preserve-test", ENGINE_PROJECT_DIR)
      expect(first.ok).toBe(true)
      const firstManifest = await readFile(path.join(designDir, "manifest.json"), "utf8")

      await writeFile(path.join(designDir, "parts", "cube.py"), "def build():\n    raise RuntimeError('intentional failure')\n")
      const second = await buildDesign(layout, "preserve-test", ENGINE_PROJECT_DIR)
      expect(second.ok).toBe(false)
      expect(second.exitCode).not.toBe(0)

      const secondManifest = await readFile(path.join(designDir, "manifest.json"), "utf8")
      expect(secondManifest).toBe(firstManifest)
    },
    (ENGINE_TIMEOUT_MS + 10_000) * 2,
  )

  test(
    "verify end-to-end: build → print plan → requirements/printability/interfaces → QC complete",
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-engine-verify-"))
      tmpRoots.push(tmpRoot)
      const designDir = path.join(tmpRoot, "verify-e2e")
      await mkdir(path.join(designDir, "parts"), { recursive: true })
      await writeFile(
        path.join(designDir, "design.json"),
        JSON.stringify({
          schema: 2,
          id: "verify-e2e",
          params: "params.py",
          acceptance: "acceptance.json",
          parts: [
            { id: "body", source: "parts/body.py", qty: 1 },
            { id: "lid", source: "parts/lid.py", qty: 1 },
          ],
        }),
      )
      const { normalizeAcceptanceContract, contractHashOf, writeAcceptance } = await import("../host/acceptance")
      const contract = normalizeAcceptanceContract({
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
      await writeAcceptance(designDir, contract)
      await writeFile(path.join(designDir, "params.py"), "SIZE = 100.0\n")
      await writeFile(
        path.join(designDir, "parts", "body.py"),
        "from build123d import Box\nfrom params import SIZE\n\ndef build():\n    return Box(SIZE, 70, 30)\n",
      )
      await writeFile(
        path.join(designDir, "parts", "lid.py"),
        "from build123d import Box, Location\nfrom params import SIZE\n\ndef build():\n    return Location((0, 0, 17.7)) * Box(SIZE, 70, 5)\n",
      )

      const layout = await initializeStudio(tmpRoot)
      const built = await buildDesign(layout, "verify-e2e", ENGINE_PROJECT_DIR)
      expect(built.ok).toBe(true)

      const { readArtifactManifest } = await import("../host/manifest")
      const artifact = (await readArtifactManifest(designDir, "verify-e2e"))!
      const { buildPrintPlan, writePrintPlan } = await import("../host/print-plan")
      const plan = buildPrintPlan({
        id: "verify-e2e",
        artifact,
        acceptance: { ...contract, contractHash: contractHashOf(contract) },
        entries: [
          { artifactId: "body", rotateDeg: [0, 0, 0], translateMm: [0, 0, 15] },
          { artifactId: "lid", rotateDeg: [0, 0, 0], translateMm: [0, 0, -15.2] },
        ],      })
      await writePrintPlan(designDir, plan)

      const { runCadVerify } = await import("../host/verify")
      for (const kind of ["requirements", "printability", "interfaces"] as const) {
        const { records } = await runCadVerify({
          designDir,
          id: "verify-e2e",
          engineProjectDir: ENGINE_PROJECT_DIR,
          cwd: process.cwd(),
          artifact,
          acceptance: { ...contract, contractHash: contractHashOf(contract) },
          kind,
        })
        expect(records.length).toBeGreaterThan(0)
        for (const record of records) {
          expect(record.status, `${record.id} should pass`).toBe("pass")
          expect(record.findings, `${record.id} findings`).toEqual([])
        }
      }

      const { findDesign } = await import("../host/library")
      const { buildDesignQcReport } = await import("../host/qc-report")
      const entry = (await findDesign(layout, "verify-e2e"))!
      const report = await buildDesignQcReport({ id: "verify-e2e", entry, artifact, designDir })
      expect(report.complete).toBe(true)
      expect(report.blockedBy).toEqual([])
    },
    (ENGINE_TIMEOUT_MS + 10_000) * 4,
  )
})
