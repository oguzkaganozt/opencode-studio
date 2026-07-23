import { describe, expect, test } from "bun:test"
import {
  artifactRevision,
  DESIGN_SCHEMA,
  ID_PATTERN,
  ManifestError,
  validateArtifactManifest,
  validateDesignManifest,
} from "../src/manifest"

describe("ID_PATTERN", () => {
  test("accepts lowercase slugs", () => {
    expect(ID_PATTERN.test("box-lid-demo")).toBe(true)
    expect(ID_PATTERN.test("cabinet_shell")).toBe(true)
    expect(ID_PATTERN.test("a1")).toBe(true)
  })
  test("rejects invalid ids", () => {
    expect(ID_PATTERN.test("")).toBe(false)
    expect(ID_PATTERN.test("-x")).toBe(false)
    expect(ID_PATTERN.test("UPPER")).toBe(false)
    expect(ID_PATTERN.test("has space")).toBe(false)
  })
})

describe("validateDesignManifest", () => {
  test("accepts a valid manifest", () => {
    const manifest = validateDesignManifest({
      schema: 1,
      id: "box-lid-demo",
      params: "params.py",
      parts: [
        { id: "box", source: "parts/box.py" },
        { id: "lid", source: "parts/lid.py" },
      ],
    })
    expect(manifest.schema).toBe(DESIGN_SCHEMA)
    expect(manifest.id).toBe("box-lid-demo")
    expect(manifest.parts).toHaveLength(2)
  })

  test("rejects wrong schema", () => {
    expect(() => validateDesignManifest({ schema: 2, id: "x", parts: [{ id: "p", source: "parts/p.py" }] })).toThrow(ManifestError)
  })

  test("rejects missing parts", () => {
    expect(() => validateDesignManifest({ schema: 1, id: "x", parts: [] })).toThrow(ManifestError)
  })

  test("rejects duplicate part ids", () => {
    expect(() =>
      validateDesignManifest({
        schema: 1,
        id: "x",
        parts: [
          { id: "p", source: "parts/p.py" },
          { id: "p", source: "parts/q.py" },
        ],
      }),
    ).toThrow(ManifestError)
  })

  test("rejects non-py source", () => {
    expect(() => validateDesignManifest({ schema: 1, id: "x", parts: [{ id: "p", source: "parts/p.txt" }] })).toThrow(ManifestError)
  })

  test("rejects invalid part id", () => {
    expect(() => validateDesignManifest({ schema: 1, id: "x", parts: [{ id: "UPPER", source: "parts/p.py" }] })).toThrow(ManifestError)
  })

  test("rejects invalid design id", () => {
    expect(() => validateDesignManifest({ schema: 1, id: "UPPER", parts: [{ id: "p", source: "parts/p.py" }] })).toThrow(ManifestError)
  })

  test("rejects part sources outside parts/", () => {
    expect(() => validateDesignManifest({ schema: 1, id: "x", parts: [{ id: "p", source: "../p.py" }] })).toThrow(ManifestError)
  })
})

describe("validateArtifactManifest", () => {
  const valid = {
    schema: 1,
    id: "demo",
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
    build: { engine: "forge-cad/1", inputs: { "design.json": "a".repeat(64) } },
  }

  test("accepts canonical artifact paths and metrics", () => {
    expect(validateArtifactManifest(valid).parts[0].id).toBe("body")
  })

  test("rejects unsafe or mismatched artifact paths", () => {
    const value = structuredClone(valid)
    value.parts[0].files.glb = "../body.glb"
    expect(() => validateArtifactManifest(value)).toThrow(/glb path/)
  })

  test("rejects non-finite metrics", () => {
    const value = structuredClone(valid)
    value.parts[0].metrics.volume_mm3 = Number.NaN
    expect(() => validateArtifactManifest(value)).toThrow(/volume_mm3/)
  })

  test("accepts legacy metrics and validates optional artifact integrity metrics", () => {
    const legacy = structuredClone(valid) as any
    delete legacy.parts[0].metrics.bounds_mm
    delete legacy.parts[0].metrics.solid_count
    expect(validateArtifactManifest(legacy).parts[0].metrics.bounds_mm).toBeUndefined()

    const invalidBounds = structuredClone(valid) as any
    invalidBounds.parts[0].metrics.bounds_mm = { min: [0, 0, 0], max: [0, 1, 1] }
    expect(() => validateArtifactManifest(invalidBounds)).toThrow(/bounds_mm/)

    const invalidSolidCount = structuredClone(valid)
    invalidSolidCount.parts[0].metrics.solid_count = 0
    expect(() => validateArtifactManifest(invalidSolidCount)).toThrow(/solid_count/)
  })

  test("derives a stable revision from sorted build inputs", () => {
    const first = validateArtifactManifest({
      ...structuredClone(valid),
      build: { engine: "forge-cad/1", inputs: { "parts/body.py": "b".repeat(64), "design.json": "a".repeat(64) } },
    })
    const reordered = validateArtifactManifest({
      ...structuredClone(valid),
      build: { engine: "forge-cad/1", inputs: { "design.json": "a".repeat(64), "parts/body.py": "b".repeat(64) } },
    })
    expect(artifactRevision(first)).toBe(artifactRevision(reordered))

    reordered.build.inputs["parts/body.py"] = "c".repeat(64)
    expect(artifactRevision(first)).not.toBe(artifactRevision(reordered))
  })
})
