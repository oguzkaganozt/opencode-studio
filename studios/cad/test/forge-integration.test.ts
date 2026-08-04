import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildDesign } from "../forge"
import { initializeStudio } from "../library"

const FORGE_PROJECT_DIR = path.resolve(import.meta.dir, "..", "forge")
const FORGE_TIMEOUT_MS = 90_000

const tmpRoots: string[] = []
afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function makeDesign(designsRoot: string, id: string): Promise<string> {
  const designDir = path.join(designsRoot, id)
  await mkdir(path.join(designDir, "parts"), { recursive: true })
  await writeFile(
    path.join(designDir, "design.json"),
    JSON.stringify({
      schema: 1,
      id,
      params: "params.py",
      parts: [{ id: "cube", source: "parts/cube.py" }],
    }),
  )
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
      const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-forge-int-"))
      tmpRoots.push(tmpRoot)
      await makeDesign(tmpRoot, "cube-test")

      const layout = await initializeStudio(tmpRoot)
      const result = await buildDesign(layout, "cube-test", FORGE_PROJECT_DIR)

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
    },
    FORGE_TIMEOUT_MS + 10_000,
  )

  test(
    "failed build preserves previous output (subprocess)",
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-forge-preserve-"))
      tmpRoots.push(tmpRoot)
      const designDir = await makeDesign(tmpRoot, "preserve-test")

      const layout = await initializeStudio(tmpRoot)
      const first = await buildDesign(layout, "preserve-test", FORGE_PROJECT_DIR)
      expect(first.ok).toBe(true)
      const firstManifest = await readFile(path.join(designDir, "manifest.json"), "utf8")

      await writeFile(path.join(designDir, "parts", "cube.py"), "def build():\n    raise RuntimeError('intentional failure')\n")
      const second = await buildDesign(layout, "preserve-test", FORGE_PROJECT_DIR)
      expect(second.ok).toBe(false)
      expect(second.exitCode).not.toBe(0)

      const secondManifest = await readFile(path.join(designDir, "manifest.json"), "utf8")
      expect(secondManifest).toBe(firstManifest)
    },
    (FORGE_TIMEOUT_MS + 10_000) * 2,
  )
})
