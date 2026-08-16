import { describe, expect, test } from "bun:test"
import type { AcceptanceV1 } from "../host/acceptance"
import type { ArtifactManifest } from "../host/manifest"
import { applyPose, buildPrintPlan, posedBounds } from "../host/print-plan"

const artifact: ArtifactManifest = {
  schema: 1,
  id: "demo",
  parts: [
    {
      id: "body",
      files: { step: "step/body.step", stl: "stl/body.stl", glb: "glb/body.glb" },
      body_hash: "a".repeat(64),
      metrics: {
        volume_mm3: 1000,
        size_mm: { x: 100, y: 70, z: 30 },
        bounds_mm: { min: [-50, -35, 0], max: [50, 35, 30] },
        solid_count: 1,
      },
    },
    {
      id: "lid",
      files: { step: "step/lid.step", stl: "stl/lid.stl", glb: "glb/lid.glb" },
      body_hash: "b".repeat(64),
      metrics: {
        volume_mm3: 500,
        size_mm: { x: 100, y: 70, z: 10 },
        bounds_mm: { min: [-50, -35, 0], max: [50, 35, 10] },
        solid_count: 1,
      },
    },
  ],
  build: { engine: "forge-cad/1", inputs: { "design.json": "a".repeat(64) } },
}

const acceptance: AcceptanceV1 = {
  schema: 1,
  state: "locked",
  authority: "harness",
  contractHash: "c".repeat(64),
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
}

describe("print plan", () => {
  test("applyPose rotates about X, Y, Z then translates", () => {
    expect(applyPose([0, 1, 0], [90, 0, 0], [0, 0, 0])[2]).toBeCloseTo(1, 6)
    expect(applyPose([1, 0, 0], [0, 90, 0], [0, 0, 0])[2]).toBeCloseTo(-1, 6)
    expect(applyPose([0, 0, 0], [0, 0, 0], [1, 2, 3])).toEqual([1, 2, 3])
  })

  test("applyPose matches build123d Location Intrinsic.XYZ for multi-axis poses", () => {
    // Empirically pinned against the engine: Location((0,0,0),(90,90,0)) maps
    // (1,0,0) -> (0,1,0); (30,60,90) maps (1,1,1) -> (0.366, 0.183, 1.683).
    const a = applyPose([1, 0, 0], [90, 90, 0], [0, 0, 0])
    expect(a[1]).toBeCloseTo(1, 6)
    expect(Math.abs(a[2])).toBeLessThan(1e-6)
    const b = applyPose([1, 1, 1], [30, 60, 90], [0, 0, 0])
    expect(b[0]).toBeCloseTo(0.3660254037844386, 6)
    expect(b[1]).toBeCloseTo(0.18301270189221952, 6)
    expect(b[2]).toBeCloseTo(1.6830127018922194, 6)
  })

  test("posedBounds of a bed-sitting box on identity pose", () => {
    const bounds = posedBounds({ min: [-50, -35, 0], max: [50, 35, 30] }, [0, 0, 0], [0, 0, 0])
    expect(bounds.min[2]).toBe(0)
    expect(bounds.max[2]).toBe(30)
  })

  test("buildPrintPlan fills bodyHash and bounds, requires full coverage", () => {
    const plan = buildPrintPlan({
      id: "demo",
      artifact,
      acceptance,
      entries: [
        { artifactId: "body", rotateDeg: [0, 0, 0], translateMm: [0, 0, 0] },
        { artifactId: "lid", rotateDeg: [0, 0, 0], translateMm: [0, 0, 0] },
      ],
    })
    expect(plan.entries).toHaveLength(2)
    expect(plan.entries[0]?.bodyHash).toBe("a".repeat(64))
    expect(plan.entries[0]?.boundsMm.min[2]).toBe(0)
    expect(plan.buildRevision).toMatch(/^[a-f0-9]{64}$/)
  })

  test("missing artifact entries are rejected", () => {
    expect(() =>
      buildPrintPlan({
        id: "demo",
        artifact,
        acceptance,
        entries: [{ artifactId: "body", rotateDeg: [0, 0, 0], translateMm: [0, 0, 0] }],
      }),
    ).toThrow(/Missing print plan entry for artifact lid/)
  })

  test("a pose floating off the bed is rejected", () => {
    expect(() =>
      buildPrintPlan({
        id: "demo",
        artifact,
        acceptance,
        entries: [
          { artifactId: "body", rotateDeg: [0, 0, 0], translateMm: [0, 0, 5] },
          { artifactId: "lid", rotateDeg: [0, 0, 0], translateMm: [0, 0, 0] },
        ],
      }),
    ).toThrow(/not on the bed/)
  })

  test("a pose exceeding the build volume is rejected", () => {
    const wide: ArtifactManifest = {
      ...artifact,
      parts: [
        {
          ...artifact.parts[0]!,
          id: "body",
          metrics: {
            ...artifact.parts[0]!.metrics!,
            bounds_mm: { min: [-150, -10, 0], max: [150, 10, 10] },
            size_mm: { x: 300, y: 20, z: 10 },
          },
        },
        ...artifact.parts.slice(1),
      ],
    }
    expect(() =>
      buildPrintPlan({
        id: "demo",
        artifact: wide,
        acceptance,
        entries: [
          { artifactId: "body", rotateDeg: [0, 0, 0], translateMm: [0, 0, 0] },
          { artifactId: "lid", rotateDeg: [0, 0, 0], translateMm: [0, 0, 0] },
        ],
      }),
    ).toThrow(/build volume/)
  })
})
