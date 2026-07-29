import { describe, expect, test } from "bun:test"
import { polygonArea2d } from "./region-geometry"
import {
  axisAlignedRect2d,
  collectPinPairMeasures,
  distance3,
  formatMm,
  lastPinPairMeasure,
  pointsNearPlane,
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

  test("rectMeetsMinSize", () => {
    expect(rectMeetsMinSize(0.4, 10, 1)).toBe(false)
    expect(rectMeetsMinSize(2, 2, 1)).toBe(true)
    expect(rectMeetsMinSize(0.6, 0.6, 1)).toBe(false)
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
