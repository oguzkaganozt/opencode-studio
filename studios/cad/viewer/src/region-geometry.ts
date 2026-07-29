import type { Vec2, Vec3 } from "./assembly-types"

export type PlaneFrame = {
  origin: Vec3
  normal: Vec3
  xAxis: Vec3
  yAxis: Vec3
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function normalize(v: Vec3): Vec3 {
  const len = length(v)
  if (len < 1e-12) return { x: 0, y: 0, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

/** Build orthonormal plane frame from origin + outward normal. */
export function buildPlaneFrame(origin: Vec3, normalIn: Vec3): PlaneFrame | null {
  const normal = normalize(normalIn)
  if (length(normal) < 1e-8) return null
  const helper = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const xAxis = normalize(cross(helper, normal))
  if (length(xAxis) < 1e-8) return null
  const yAxis = normalize(cross(normal, xAxis))
  return { origin, normal, xAxis, yAxis }
}

export function toPlane2d(point: Vec3, frame: PlaneFrame): Vec2 {
  const d = sub(point, frame.origin)
  return { u: dot(d, frame.xAxis), v: dot(d, frame.yAxis) }
}

export function fromPlane2d(p: Vec2, frame: PlaneFrame): Vec3 {
  return add(frame.origin, add(scale(frame.xAxis, p.u), scale(frame.yAxis, p.v)))
}

export function centroid3(points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 }
  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = points.length
  return { x: x / n, y: y / n, z: z / n }
}

/** Signed area in plane (2D shoelace). */
export function polygonArea2d(ring: Vec2[]): number {
  if (ring.length < 3) return 0
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    sum += a.u * b.v - b.u * a.v
  }
  return sum * 0.5
}

/** Ensure CCW when viewing against +normal (positive 2d area). */
export function ensureCcw2d(ring: Vec2[]): Vec2[] {
  if (polygonArea2d(ring) >= 0) return ring
  return ring.slice().reverse()
}

function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function distSq2(a: Vec2, b: Vec2): number {
  const du = a.u - b.u
  const dv = a.v - b.v
  return du * du + dv * dv
}

function perpendicularDistance2(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.u - start.u
  const dy = end.v - start.v
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-18) return Math.sqrt(distSq2(point, start))
  const t = ((point.u - start.u) * dx + (point.v - start.v) * dy) / lenSq
  const proj = { u: start.u + t * dx, v: start.v + t * dy }
  return Math.sqrt(distSq2(point, proj))
}

function perpendicularDistance3(point: Vec3, start: Vec3, end: Vec3): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  const lenSq = dx * dx + dy * dy + dz * dz
  if (lenSq < 1e-18) return Math.sqrt(distSq3(point, start))
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / lenSq
  const proj = { x: start.x + t * dx, y: start.y + t * dy, z: start.z + t * dz }
  return Math.sqrt(distSq3(point, proj))
}

function rdp2(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2) return points.slice()
  let maxDist = 0
  let index = 0
  const end = points.length - 1
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance2(points[i]!, points[0]!, points[end]!)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = rdp2(points.slice(0, index + 1), epsilon)
    const right = rdp2(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [points[0]!, points[end]!]
}

function rdp3(points: Vec3[], epsilon: number): Vec3[] {
  if (points.length <= 2) return points.slice()
  let maxDist = 0
  let index = 0
  const end = points.length - 1
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance3(points[i]!, points[0]!, points[end]!)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = rdp3(points.slice(0, index + 1), epsilon)
    const right = rdp3(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [points[0]!, points[end]!]
}

/** Simplify to at most maxVerts (keeps endpoints). */
export function simplify2d(points: Vec2[], maxVerts: number): Vec2[] {
  if (points.length <= maxVerts) return points.slice()
  let epsilon = 0.05
  let result = points.slice()
  for (let i = 0; i < 24 && result.length > maxVerts; i++) {
    result = rdp2(points, epsilon)
    epsilon *= 1.6
  }
  if (result.length <= maxVerts) return result
  // Uniform subsample fallback
  const out: Vec2[] = [points[0]!]
  const step = (points.length - 1) / (maxVerts - 1)
  for (let i = 1; i < maxVerts - 1; i++) out.push(points[Math.round(i * step)]!)
  out.push(points[points.length - 1]!)
  return out
}

export function simplify3d(points: Vec3[], maxVerts: number): Vec3[] {
  if (points.length <= maxVerts) return points.slice()
  let epsilon = 0.05
  let result = points.slice()
  for (let i = 0; i < 24 && result.length > maxVerts; i++) {
    result = rdp3(points, epsilon)
    epsilon *= 1.6
  }
  if (result.length <= maxVerts) return result
  const out: Vec3[] = [points[0]!]
  const step = (points.length - 1) / (maxVerts - 1)
  for (let i = 1; i < maxVerts - 1; i++) out.push(points[Math.round(i * step)]!)
  out.push(points[points.length - 1]!)
  return out
}

export function nearStartScreen(dx: number, dy: number, thresholdPx = 12): boolean {
  return dx * dx + dy * dy <= thresholdPx * thresholdPx
}

export function round3(n: number): number {
  return +n.toFixed(3)
}

export function roundVec3(v: Vec3): Vec3 {
  return { x: round3(v.x), y: round3(v.y), z: round3(v.z) }
}

export function roundVec2(v: Vec2): Vec2 {
  return { u: round3(v.u), v: round3(v.v) }
}
