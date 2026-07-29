import { describe, expect, test } from "bun:test"
import {
  boundaryEdgesFromTriangles,
  closestOnEdgeScreen,
  dedupeVertices,
  faceCentroid,
  resolveMeshSnap,
  resolveVertexSnap,
  VERTEX_SNAP_PX,
} from "./snap-geometry"

describe("snap-geometry", () => {
  test("dedupeVertices quantizes and uniques", () => {
    const out = dedupeVertices(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0.01, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      0.05,
    )
    expect(out).toHaveLength(2)
  })

  test("resolveVertexSnap picks nearest screen vertex", () => {
    const verts = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ]
    const project = (p: { x: number; y: number; z: number }) => ({ x: p.x * 10, y: 100 })
    const hit = { x: 0.5, y: 0, z: 0 }
    const r = resolveVertexSnap(hit, 2, 100, verts, project, VERTEX_SNAP_PX)
    expect(r.snap).toBe("vertex")
    expect(r.position.x).toBe(0)
    expect(r.quality).toBe("mesh-approx")
  })

  test("resolveVertexSnap free when outside threshold", () => {
    const verts = [{ x: 0, y: 0, z: 0 }]
    const project = () => ({ x: 0, y: 0 })
    const hit = { x: 1, y: 2, z: 3 }
    const r = resolveVertexSnap(hit, 100, 100, verts, project, 10)
    expect(r.snap).toBe("free")
    expect(r.position).toEqual(hit)
  })

  test("boundaryEdgesFromTriangles keeps rim only", () => {
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ]
    // two tris sharing diagonal 0-2
    const edges = boundaryEdgesFromTriangles(positions, [
      [0, 1, 2],
      [0, 2, 3],
    ])
    expect(edges).toHaveLength(4)
  })

  test("resolveMeshSnap prefers edge over free", () => {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 10, y: 0, z: 0 }
    const project = (p: { x: number; y: number; z: number }) => ({ x: p.x * 10, y: 50 })
    const r = resolveMeshSnap(
      { x: 5, y: 1, z: 0 },
      50,
      52,
      { vertices: [], edges: [{ a, b }], center: null },
      project,
      5,
      20,
    )
    expect(r.snap === "edge" || r.snap === "midpoint").toBe(true)
    expect(r.position.y).toBeCloseTo(0, 5)
  })

  test("closestOnEdgeScreen midpoint param", () => {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 10, y: 0, z: 0 }
    const project = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: 0 })
    const c = closestOnEdgeScreen(5, 0, a, b, project)
    expect(c).not.toBeNull()
    expect(c!.t).toBeCloseTo(0.5, 5)
  })

  test("resolveMeshSnap face center", () => {
    const verts = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]
    const center = faceCentroid(verts)!
    const project = (p: { x: number; y: number; z: number }) => ({ x: p.x * 10, y: p.y * 10 })
    // Cursor near face center in screen space, away from verts/edges
    const r = resolveMeshSnap({ x: 5, y: 5, z: 0 }, 50, 50, { vertices: verts, edges: [], center }, project, 5, 5, 20)
    expect(r.snap).toBe("center")
    expect(r.position.x).toBeCloseTo(5, 5)
    expect(r.position.y).toBeCloseTo(5, 5)
  })
})
