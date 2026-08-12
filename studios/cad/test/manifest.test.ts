import { describe, expect, test } from "bun:test"
import { ID_PATTERN, validateArtifactManifest, validateDesignManifest } from "../host/manifest"

describe("manifest validation smoke", () => {
  test("accepts a valid design and artifact manifest", () => {
    expect(ID_PATTERN.test("box-lid-demo")).toBe(true)
    expect(ID_PATTERN.test("Bad")).toBe(false)

    const design = validateDesignManifest({
      schema: 1,
      id: "box-lid-demo",
      parts: [
        { id: "body", source: "parts/body.py" },
        { id: "lid", source: "parts/lid.py" },
      ],
    })
    expect(design.id).toBe("box-lid-demo")

    const artifact = validateArtifactManifest({
      schema: 1,
      id: "box-lid-demo",
      parts: [
        {
          id: "body",
          files: { step: "step/body.step", stl: "stl/body.stl", glb: "glb/body.glb", topo: "topo/body.json" },
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
        inputs: { "design.json": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      },
    })
    expect(artifact.parts).toHaveLength(1)
    expect(artifact.parts[0]?.files.topo).toBe("topo/body.json")
  })

  test("rejects unsafe artifact paths and invalid design ids", () => {
    expect(() =>
      validateDesignManifest({
        schema: 1,
        id: "Bad",
        parts: [{ id: "body", source: "parts/body.py" }],
      }),
    ).toThrow()

    expect(() =>
      validateArtifactManifest({
        schema: 1,
        id: "box-lid-demo",
        parts: [
          {
            id: "body",
            files: { step: "../escape.step", stl: "stl/body.stl", glb: "glb/body.glb" },
            metrics: {
              volume_mm3: 1,
              size_mm: { x: 1, y: 1, z: 1 },
              bounds_mm: { min: [0, 0, 0], max: [1, 1, 1] },
              solid_count: 1,
            },
          },
        ],
        build: {
          engine: "forge-cad/1",
          inputs: { "design.json": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        },
      }),
    ).toThrow()
  })
})
