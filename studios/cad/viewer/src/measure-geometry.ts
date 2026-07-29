import type { LinkedPinPair, Vec2, Vec3 } from "./assembly-types"
import { ensureCcw2d } from "./region-geometry"

export const MIN_RECT_SIDE_MM = 0.5
/** Mesh verts farther than this from hit plane → not planar enough for Rect. */
export const RECT_PLANE_TOL_MM = 0.35

export const MAX_LINKED_PAIRS = 4

export type { LinkedPinPair }

export type PinPairMeasure = {
  fromIndex: number
  toIndex: number
  distance_mm: number
  quality: "construction"
  source: "linked" | "last"
}

export type AxisAlignedRect2d = {
  boundary2d: Vec2[]
  width_mm: number
  height_mm: number
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function formatMm(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

/** Last pin ↔ previous pin (1-based prompt indices). Null if fewer than 2 picks. */
export function lastPinPairMeasure(picks: ReadonlyArray<{ position: Vec3 }>): PinPairMeasure | null {
  if (picks.length < 2) return null
  const toIndex = picks.length
  const fromIndex = picks.length - 1
  const a = picks[fromIndex - 1]!
  const b = picks[toIndex - 1]!
  return {
    fromIndex,
    toIndex,
    distance_mm: distance3(a.position, b.position),
    quality: "construction",
    source: "last",
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Linked pairs first (cap), then last↔previous if not already included. */
export function collectPinPairMeasures(
  picks: ReadonlyArray<{ id?: string; position: Vec3 }>,
  linked: ReadonlyArray<LinkedPinPair>,
): PinPairMeasure[] {
  const idToIndex = new Map<string, number>()
  picks.forEach((p, i) => {
    if (p.id) idToIndex.set(p.id, i + 1)
  })
  const out: PinPairMeasure[] = []
  const seen = new Set<string>()
  for (const link of linked) {
    if (out.length >= MAX_LINKED_PAIRS) break
    const fromIndex = idToIndex.get(link.fromId)
    const toIndex = idToIndex.get(link.toId)
    if (fromIndex === undefined || toIndex === undefined) continue
    const key = pairKey(link.fromId, link.toId)
    if (seen.has(key)) continue
    seen.add(key)
    const a = picks[fromIndex - 1]!
    const b = picks[toIndex - 1]!
    out.push({
      fromIndex,
      toIndex,
      distance_mm: distance3(a.position, b.position),
      quality: "construction",
      source: "linked",
    })
  }
  const last = lastPinPairMeasure(picks)
  if (last) {
    const fromId = picks[last.fromIndex - 1]?.id
    const toId = picks[last.toIndex - 1]?.id
    const key = fromId && toId ? pairKey(fromId, toId) : `i:${last.fromIndex}|${last.toIndex}`
    if (!seen.has(key)) {
      out.push(last)
    }
  }
  return out
}

export function undirectedPairExists(linked: ReadonlyArray<LinkedPinPair>, a: string, b: string): boolean {
  const key = pairKey(a, b)
  return linked.some((p) => pairKey(p.fromId, p.toId) === key)
}

export type EdgeOffsetGuide = {
  foot: Vec3
  distance_mm: number
  a: Vec3
  b: Vec3
}

/** Closest point on segment AB to P; distance in mm. */
export function pointToSegment(
  p: Vec3,
  a: Vec3,
  b: Vec3,
): { distance_mm: number; closest: Vec3; t: number } {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const lenSq = abx * abx + aby * aby + abz * abz
  let t = 0
  if (lenSq > 1e-18) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq
    t = Math.max(0, Math.min(1, t))
  }
  const closest = { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t }
  return {
    distance_mm: distance3(p, closest),
    closest,
    t,
  }
}

/** Nearest distinct boundary-edge offsets from point (for snap overlay guides). */
export function nearestEdgeOffsets(
  p: Vec3,
  edges: ReadonlyArray<{ a: Vec3; b: Vec3 }>,
  maxCount = 2,
): EdgeOffsetGuide[] {
  if (edges.length === 0 || maxCount <= 0) return []
  const scored = edges
    .map((e) => {
      const r = pointToSegment(p, e.a, e.b)
      return { a: e.a, b: e.b, foot: r.closest, distance_mm: r.distance_mm }
    })
    .sort((x, y) => x.distance_mm - y.distance_mm)

  const out: EdgeOffsetGuide[] = []
  for (const s of scored) {
    if (s.distance_mm < 1e-4) continue // on the edge already
    const dup = out.some(
      (o) =>
        Math.abs(o.distance_mm - s.distance_mm) < 0.2 &&
        distance3(o.foot, s.foot) < 0.75,
    )
    if (dup) continue
    out.push(s)
    if (out.length >= maxCount) break
  }
  return out
}

/** True if all sample points lie within tolMm of the plane (origin + unit normal). */
export function pointsNearPlane(
  points: ReadonlyArray<Vec3>,
  origin: Vec3,
  normalIn: Vec3,
  tolMm = RECT_PLANE_TOL_MM,
): boolean {
  if (points.length < 3) return false
  const len = Math.hypot(normalIn.x, normalIn.y, normalIn.z)
  if (len < 1e-12) return false
  const nx = normalIn.x / len
  const ny = normalIn.y / len
  const nz = normalIn.z / len
  for (const p of points) {
    const d = Math.abs((p.x - origin.x) * nx + (p.y - origin.y) * ny + (p.z - origin.z) * nz)
    if (d > tolMm) return false
  }
  return true
}

/** Axis-aligned rect in viewer plane UV from two opposite corners. Sides // frame u/v. */
export function axisAlignedRect2d(corner0: Vec2, corner1: Vec2): AxisAlignedRect2d {
  const u0 = Math.min(corner0.u, corner1.u)
  const u1 = Math.max(corner0.u, corner1.u)
  const v0 = Math.min(corner0.v, corner1.v)
  const v1 = Math.max(corner0.v, corner1.v)
  const ring = [
    { u: u0, v: v0 },
    { u: u1, v: v0 },
    { u: u1, v: v1 },
    { u: u0, v: v1 },
  ]
  return {
    boundary2d: ensureCcw2d(ring),
    width_mm: u1 - u0,
    height_mm: v1 - v0,
  }
}

/** UV bbox center of an axis-aligned ring (min 1 point). */
export function rectCenter2d(boundary2d: ReadonlyArray<Vec2>): Vec2 {
  if (boundary2d.length === 0) return { u: 0, v: 0 }
  let u0 = boundary2d[0]!.u
  let u1 = u0
  let v0 = boundary2d[0]!.v
  let v1 = v0
  for (let i = 1; i < boundary2d.length; i++) {
    const p = boundary2d[i]!
    u0 = Math.min(u0, p.u)
    u1 = Math.max(u1, p.u)
    v0 = Math.min(v0, p.v)
    v1 = Math.max(v1, p.v)
  }
  return { u: (u0 + u1) / 2, v: (v0 + v1) / 2 }
}

/** Axis-aligned rect centered on `center` with given W×H (viewer-plane UV). */
export function axisAlignedRectCentered(center: Vec2, width_mm: number, height_mm: number): AxisAlignedRect2d {
  const hw = width_mm / 2
  const hh = height_mm / 2
  return axisAlignedRect2d({ u: center.u - hw, v: center.v - hh }, { u: center.u + hw, v: center.v + hh })
}

export function rectMeetsMinSize(width_mm: number, height_mm: number, minAreaMm2: number): boolean {
  if (width_mm < MIN_RECT_SIDE_MM || height_mm < MIN_RECT_SIDE_MM) return false
  return width_mm * height_mm >= minAreaMm2
}

/** Screen-space point-in-polygon (ray cast). Ring open or closed. */
export function pointInPoly2(x: number, y: number, ring: ReadonlyArray<{ x: number; y: number }>): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x
    const yi = ring[i]!.y
    const xj = ring[j]!.x
    const yj = ring[j]!.y
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi
    if (intersect) inside = !inside
  }
  return inside
}
