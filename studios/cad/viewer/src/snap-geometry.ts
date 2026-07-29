import type { Vec3 } from "./assembly-types"

export const VERTEX_SNAP_PX = 14
export const EDGE_SNAP_PX = 12
export const CENTER_SNAP_PX = 16
export const VERTEX_QUANTIZE_MM = 0.05
export const MIN_MIDPOINT_EDGE_MM = 2

export type SnapKind = "vertex" | "edge" | "midpoint" | "center" | "free"
export type SnapQuality = "mesh-approx"

export type SnapEdge = { a: Vec3; b: Vec3 }

export type SnapIndex = {
  vertices: Vec3[]
  edges: SnapEdge[]
  /** Face centroid (mean of unique verts) — face center snap. */
  center: Vec3 | null
}

export function dedupeVertices(points: ReadonlyArray<Vec3>, quantizeMm = VERTEX_QUANTIZE_MM): Vec3[] {
  const seen = new Set<string>()
  const out: Vec3[] = []
  for (const p of points) {
    const kx = Math.round(p.x / quantizeMm)
    const ky = Math.round(p.y / quantizeMm)
    const kz = Math.round(p.z / quantizeMm)
    const key = `${kx},${ky},${kz}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ x: kx * quantizeMm, y: ky * quantizeMm, z: kz * quantizeMm })
  }
  return out
}

export function faceCentroid(points: ReadonlyArray<Vec3>): Vec3 | null {
  if (points.length === 0) return null
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

function quantKey(p: Vec3, quantizeMm = VERTEX_QUANTIZE_MM): string {
  return `${Math.round(p.x / quantizeMm)},${Math.round(p.y / quantizeMm)},${Math.round(p.z / quantizeMm)}`
}

/** Boundary edges = mesh edges with a single incident triangle (open shell / face rim). */
export function boundaryEdgesFromTriangles(
  positions: ReadonlyArray<Vec3>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): SnapEdge[] {
  const counts = new Map<string, { a: number; b: number; n: number }>()
  const add = (i: number, j: number) => {
    const ka = quantKey(positions[i]!)
    const kb = quantKey(positions[j]!)
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    const prev = counts.get(key)
    if (prev) prev.n += 1
    else counts.set(key, { a: i, b: j, n: 1 })
  }
  for (const [i, j, k] of triangles) {
    add(i, j)
    add(j, k)
    add(k, i)
  }
  const edges: SnapEdge[] = []
  for (const e of counts.values()) {
    if (e.n !== 1) continue
    edges.push({ a: positions[e.a]!, b: positions[e.b]! })
  }
  return edges
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/** Closest point on AB to cursor in screen space; returns 3D point + screen dist². */
export function closestOnEdgeScreen(
  clientX: number,
  clientY: number,
  a: Vec3,
  b: Vec3,
  project: (p: Vec3) => { x: number; y: number } | null,
): { position: Vec3; screenDistSq: number; t: number } | null {
  const sa = project(a)
  const sb = project(b)
  if (!sa || !sb) return null
  const abx = sb.x - sa.x
  const aby = sb.y - sa.y
  const lenSq = abx * abx + aby * aby
  let t = 0
  if (lenSq > 1e-8) {
    t = ((clientX - sa.x) * abx + (clientY - sa.y) * aby) / lenSq
    t = Math.max(0, Math.min(1, t))
  }
  const sx = sa.x + abx * t
  const sy = sa.y + aby * t
  const dx = sx - clientX
  const dy = sy - clientY
  return { position: lerp3(a, b, t), screenDistSq: dx * dx + dy * dy, t }
}

export function resolveMeshSnap(
  hit: Vec3,
  clientX: number,
  clientY: number,
  index: SnapIndex,
  project: (p: Vec3) => { x: number; y: number } | null,
  vertexPx = VERTEX_SNAP_PX,
  edgePx = EDGE_SNAP_PX,
  centerPx = CENTER_SNAP_PX,
): { position: Vec3; snap: SnapKind; quality: SnapQuality } {
  let bestVertex: Vec3 | null = null
  let bestVertexD = vertexPx * vertexPx
  for (const v of index.vertices) {
    const s = project(v)
    if (!s) continue
    const dx = s.x - clientX
    const dy = s.y - clientY
    const d = dx * dx + dy * dy
    if (d <= bestVertexD) {
      bestVertexD = d
      bestVertex = v
    }
  }
  if (bestVertex) return { position: bestVertex, snap: "vertex", quality: "mesh-approx" }

  const edgeThresh = edgePx * edgePx
  let bestEdge: { position: Vec3; d: number; snap: "edge" | "midpoint" } | null = null
  for (const e of index.edges) {
    const c = closestOnEdgeScreen(clientX, clientY, e.a, e.b, project)
    if (!c || c.screenDistSq > edgeThresh) continue
    const len = Math.sqrt(distSq3(e.a, e.b))
    const mid = Math.abs(c.t - 0.5) < 0.12 && len >= MIN_MIDPOINT_EDGE_MM
    const position = mid ? lerp3(e.a, e.b, 0.5) : c.position
    const snap: "edge" | "midpoint" = mid ? "midpoint" : "edge"
    if (!bestEdge || c.screenDistSq < bestEdge.d) {
      bestEdge = { position, d: c.screenDistSq, snap }
    }
  }
  if (bestEdge) return { position: bestEdge.position, snap: bestEdge.snap, quality: "mesh-approx" }

  if (index.center) {
    const s = project(index.center)
    if (s) {
      const dx = s.x - clientX
      const dy = s.y - clientY
      if (dx * dx + dy * dy <= centerPx * centerPx) {
        return { position: index.center, snap: "center", quality: "mesh-approx" }
      }
    }
  }

  return { position: hit, snap: "free", quality: "mesh-approx" }
}

/** @deprecated use resolveMeshSnap */
export function resolveVertexSnap(
  hit: Vec3,
  clientX: number,
  clientY: number,
  vertices: ReadonlyArray<Vec3>,
  project: (p: Vec3) => { x: number; y: number } | null,
  thresholdPx = VERTEX_SNAP_PX,
): { position: Vec3; snap: SnapKind; quality: SnapQuality } {
  return resolveMeshSnap(
    hit,
    clientX,
    clientY,
    { vertices: [...vertices], edges: [], center: faceCentroid(vertices) },
    project,
    thresholdPx,
    EDGE_SNAP_PX,
  )
}
