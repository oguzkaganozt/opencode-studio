import { describe, expect, test } from "bun:test"
import { polygonArea2d } from "./region-geometry"
import {
  axisAlignedRect2d,
  axisAlignedRectCentered,
  collectPinPairMeasures,
  distance3,
  formatMm,
  lastPinPairMeasure,
  nearestEdgeOffsets,
  pointInPoly2,
  pointToSegment,
  pointsNearPlane,
  rectCenter2d,
  rectMeetsMinSize,
} from "./measure-geometry"

describe("measure-geometry", () => {
  test("distance3 is Euclidean mm", () => {
    expect(distance3({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBeCloseTo(5, 10)
    expect(distance3({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(0)
  })

  test("formatMm fixed decimals", () => {
    expect(formatMm(12.4567, 1)).toBe("12.5")
    expect(formatMm(12.4567, 2)).toBe("12.46")
  })

  test("lastPinPairMeasure needs two picks", () => {
    expect(lastPinPairMeasure([])).toBeNull()
    expect(lastPinPairMeasure([{ position: { x: 0, y: 0, z: 0 } }])).toBeNull()
  })

  test("lastPinPairMeasure uses last two indices", () => {
    const m = lastPinPairMeasure([
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 10, y: 0, z: 0 } },
      { position: { x: 10, y: 5, z: 0 } },
    ])
    expect(m).not.toBeNull()
    expect(m!.fromIndex).toBe(2)
    expect(m!.toIndex).toBe(3)
    expect(m!.distance_mm).toBeCloseTo(5, 10)
    expect(m!.quality).toBe("construction")
    expect(m!.source).toBe("last")
  })

  test("collectPinPairMeasures prefers linked and skips duplicate last", () => {
    const picks = [
      { id: "a", position: { x: 0, y: 0, z: 0 } },
      { id: "b", position: { x: 10, y: 0, z: 0 } },
      { id: "c", position: { x: 10, y: 5, z: 0 } },
    ]
    const m = collectPinPairMeasures(picks, [{ fromId: "a", toId: "c" }])
    expect(m).toHaveLength(2)
    expect(m[0]!.source).toBe("linked")
    expect(m[0]!.fromIndex).toBe(1)
    expect(m[0]!.toIndex).toBe(3)
    expect(m[0]!.distance_mm).toBeCloseTo(Math.hypot(10, 5), 8)
    expect(m[1]!.source).toBe("last")
  })

  test("axisAlignedRect2d size and CCW ring", () => {
    const r = axisAlignedRect2d({ u: 10, v: 5 }, { u: 0, v: 0 })
    expect(r.width_mm).toBeCloseTo(10, 10)
    expect(r.height_mm).toBeCloseTo(5, 10)
    expect(r.boundary2d).toHaveLength(4)
    expect(polygonArea2d(r.boundary2d)).toBeGreaterThan(0)
  })

  test("axisAlignedRectCentered keeps center", () => {
    const center = { u: 4, v: -2 }
    const r = axisAlignedRectCentered(center, 10, 6)
    expect(r.width_mm).toBeCloseTo(10, 10)
    expect(r.height_mm).toBeCloseTo(6, 10)
    expect(rectCenter2d(r.boundary2d).u).toBeCloseTo(4, 10)
    expect(rectCenter2d(r.boundary2d).v).toBeCloseTo(-2, 10)
  })

  test("pointInPoly2 square", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(pointInPoly2(5, 5, ring)).toBe(true)
    expect(pointInPoly2(15, 5, ring)).toBe(false)
  })

  test("rectMeetsMinSize", () => {
    expect(rectMeetsMinSize(0.4, 10, 1)).toBe(false)
    expect(rectMeetsMinSize(2, 2, 1)).toBe(true)
    expect(rectMeetsMinSize(0.6, 0.6, 1)).toBe(false)
  })

  test("pointToSegment midpoint and endpoint", () => {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 10, y: 0, z: 0 }
    const mid = pointToSegment({ x: 5, y: 3, z: 0 }, a, b)
    expect(mid.distance_mm).toBeCloseTo(3, 8)
    expect(mid.t).toBeCloseTo(0.5, 8)
    const end = pointToSegment({ x: -2, y: 0, z: 0 }, a, b)
    expect(end.distance_mm).toBeCloseTo(2, 8)
    expect(end.t).toBeCloseTo(0, 8)
  })

  test("nearestEdgeOffsets returns two closest distinct", () => {
    const p = { x: 3, y: 4, z: 0 }
    const edges = [
      { a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 0, z: 0 } },
      { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 10, z: 0 } },
      { a: { x: 10, y: 0, z: 0 }, b: { x: 10, y: 10, z: 0 } },
    ]
    const g = nearestEdgeOffsets(p, edges, 2)
    expect(g).toHaveLength(2)
    expect(g[0]!.distance_mm).toBeLessThanOrEqual(g[1]!.distance_mm)
    expect(g[0]!.distance_mm).toBeCloseTo(3, 5)
    expect(g[1]!.distance_mm).toBeCloseTo(4, 5)
  })

  test("pointsNearPlane accepts flat face samples", () => {
    const origin = { x: 0, y: 0, z: 5 }
    const n = { x: 0, y: 0, z: 1 }
    const pts = [
      { x: 0, y: 0, z: 5 },
      { x: 10, y: 0, z: 5.01 },
      { x: 10, y: 10, z: 4.99 },
      { x: 0, y: 10, z: 5 },
    ]
    expect(pointsNearPlane(pts, origin, n, 0.35)).toBe(true)
    expect(pointsNearPlane([...pts, { x: 0, y: 0, z: 6 }], origin, n, 0.35)).toBe(false)
  })
})
