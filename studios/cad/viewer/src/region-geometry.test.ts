import { describe, expect, test } from "bun:test"
import {
  buildPlaneFrame,
  ensureCcw2d,
  fromPlane2d,
  nearStartScreen,
  polygonArea2d,
  simplify2d,
  simplify3d,
  toPlane2d,
} from "./region-geometry"

describe("region-geometry", () => {
  test("plane frame round-trip", () => {
    const frame = buildPlaneFrame({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 })
    expect(frame).not.toBeNull()
    const p = { x: 4, y: 5, z: 3 }
    const uv = toPlane2d(p, frame!)
    const back = fromPlane2d(uv, frame!)
    expect(back.x).toBeCloseTo(4, 6)
    expect(back.y).toBeCloseTo(5, 6)
    expect(back.z).toBeCloseTo(3, 6)
  })

  test("ensureCcw2d flips clockwise ring", () => {
    const cw = [
      { u: 0, v: 0 },
      { u: 0, v: 1 },
      { u: 1, v: 1 },
      { u: 1, v: 0 },
    ]
    expect(polygonArea2d(cw)).toBeLessThan(0)
    const ccw = ensureCcw2d(cw)
    expect(polygonArea2d(ccw)).toBeGreaterThan(0)
  })

  test("simplify2d caps vertex count", () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ u: i * 0.1, v: Math.sin(i * 0.2) }))
    const out = simplify2d(pts, 64)
    expect(out.length).toBeLessThanOrEqual(64)
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out[0]).toEqual(pts[0]!)
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]!)
  })

  test("simplify3d caps vertex count", () => {
    const pts = Array.from({ length: 120 }, (_, i) => ({ x: i, y: Math.cos(i * 0.1), z: Math.sin(i * 0.1) }))
    const out = simplify3d(pts, 32)
    expect(out.length).toBeLessThanOrEqual(32)
  })

  test("nearStartScreen", () => {
    expect(nearStartScreen(0, 0)).toBe(true)
    expect(nearStartScreen(10, 0)).toBe(true)
    expect(nearStartScreen(20, 20)).toBe(false)
    expect(nearStartScreen(40, 0, 56)).toBe(true)
    expect(nearStartScreen(60, 0, 56)).toBe(false)
  })

  test("unit square area", () => {
    const ring = [
      { u: 0, v: 0 },
      { u: 10, v: 0 },
      { u: 10, v: 10 },
      { u: 0, v: 10 },
    ]
    expect(Math.abs(polygonArea2d(ring))).toBeCloseTo(100, 6)
  })
})
