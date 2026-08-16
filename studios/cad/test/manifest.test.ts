import { describe, expect, test } from "bun:test"
import {
  DESIGN_SCHEMA_2,
  expectedArtifactPartIds,
  ID_PATTERN,
  scaffoldDesignManifest,
  validateArtifactManifest,
  validateDesignManifest,
} from "../host/manifest"

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
    expect(design.parts[0]?.qty).toBe(1)
    expect(expectedArtifactPartIds([{ id: "side_trim", qty: 2 }])).toEqual(["side_trim", "side_trim_mirror"])
    expect(() =>
      validateDesignManifest({
        schema: 1,
        id: "box-lid-demo",
        parts: [
          { id: "side_trim", source: "parts/side_trim.py", qty: 2 },
          { id: "side_trim_mirror", source: "parts/side_trim_mirror.py" },
        ],
      }),
    ).toThrow(/collides/)

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

  test("validates schema 2 manifests", () => {
    const schema2 = validateDesignManifest({
      schema: 2,
      id: "box-lid-demo",
      params: "params.py",
      acceptance: "acceptance.json",
      parts: [{ id: "body", source: "parts/body.py", qty: 2 }],
    })
    expect(schema2.schema).toBe(2)
    if (schema2.schema === 2) expect(schema2.acceptance).toBe("acceptance.json")
    expect(() =>
      validateDesignManifest({
        schema: 2,
        id: "bad",
        params: "other.py",
        acceptance: "acceptance.json",
        parts: [{ id: "b", source: "parts/b.py" }],
      }),
    ).toThrow(/params/)
    expect(() =>
      validateDesignManifest({
        schema: 2,
        id: "bad",
        params: "params.py",
        acceptance: "other.json",
        parts: [{ id: "b", source: "parts/b.py" }],
      }),
    ).toThrow(/acceptance/)
  })

  test("scaffold produces schema 2 with acceptance reference", () => {
    const manifest = scaffoldDesignManifest("box", [
      { id: "body", qty: 1 },
      { id: "lid", qty: 1 },
    ])
    expect(manifest.schema).toBe(DESIGN_SCHEMA_2)
    expect(manifest.params).toBe("params.py")
    expect(manifest.acceptance).toBe("acceptance.json")
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

  test("rejects a bad body_hash", () => {
    expect(() =>
      validateArtifactManifest({
        schema: 1,
        id: "box",
        parts: [
          {
            id: "body",
            files: { step: "step/body.step", stl: "stl/body.stl", glb: "glb/body.glb" },
            body_hash: "not-a-hash",
            metrics: { volume_mm3: 1, size_mm: { x: 1, y: 1, z: 1 }, solid_count: 1 },
          },
        ],
        build: { engine: "forge-cad/1", inputs: { "design.json": "a".repeat(64) } },
      }),
    ).toThrow(/body_hash/)
  })
})
