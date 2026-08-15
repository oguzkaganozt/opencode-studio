import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensurePublicArtifactLinks, resolveArtifactGeneration } from "../host/artifacts"
import { readArtifactManifest } from "../host/manifest"

const GENERATION = "547c2b99bf784c3eb5ce2dda95a56fb9"

const manifest = {
  schema: 1,
  id: "wall-sconce",
  parts: [
    {
      id: "base",
      files: { step: "step/base.step", stl: "stl/base.stl", glb: "glb/base.glb", topo: "topo/base.json" },
      metrics: {
        volume_mm3: 1,
        size_mm: { x: 1, y: 1, z: 1 },
        bounds_mm: { min: [0, 0, 0], max: [1, 1, 1] },
        solid_count: 1,
        face_count: 6,
      },
    },
  ],
  build: {
    engine: "forge-cad/1",
    inputs: { "design.json": "a".repeat(64) },
  },
}

describe("relocatable artifact links", () => {
  test("repairs absolute current + public links from a generation dir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cad-art-"))
    const artifacts = path.join(root, ".artifacts")
    const gen = path.join(artifacts, GENERATION)
    await mkdir(gen, { recursive: true })
    await writeFile(path.join(gen, "manifest.json"), `${JSON.stringify(manifest)}\n`)
    await symlink(`/tmp/osc-bench-gone/home/studio/designs/wall-sconce/.artifacts/${GENERATION}`, path.join(artifacts, "current"))
    await symlink("/tmp/osc-bench-gone/home/studio/designs/wall-sconce/.artifacts/current/manifest.json", path.join(root, "manifest.json"))

    expect(await resolveArtifactGeneration(root)).toBe(GENERATION)
    expect(await readArtifactManifest(root, "wall-sconce")).toMatchObject({ id: "wall-sconce" })
    expect(await ensurePublicArtifactLinks(root)).toBe(GENERATION)
    expect(await Bun.file(path.join(root, "manifest.json")).text()).toContain("wall-sconce")
  })
})
