import type { dominantDirection } from "./geometry"

export const PART_COLORS = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0xfabed4, 0x469990, 0xdcbeff, 0x9a6324,
  0xfffac8, 0x800000, 0xaaffc3, 0x808000, 0xffd8b1, 0x000075, 0xa9a9a9,
]

export type PartTopo = {
  schema: 1
  partId: string
  faceCount: number
  triangleCount: number
  triangleFaceIds: number[]
  faces: Array<{ id: number; triangleCount: number; type?: string }>
}

export type Vec3 = { x: number; y: number; z: number }
export type Vec2 = { u: number; v: number }

export type PickSnap = "vertex" | "edge" | "midpoint" | "center" | "free"
export type PickQuality = "mesh-approx"

export type ClickInfo = {
  id?: string
  position: Vec3
  normal: Vec3
  part: string
  direction: ReturnType<typeof dominantDirection>
  partIndex: number
  faceId: number | null
  faceType: string | null
  triangleIndex: number | null
  snap?: PickSnap
  quality?: PickQuality
}

export type LinkedPinPair = { fromId: string; toId: string }

/** True when two picks are the same pin (same part, nearly same point). */
export function picksMatch(a: ClickInfo, b: ClickInfo, tol = 0.35): boolean {
  if (a.partIndex !== b.partIndex) return false
  const dx = a.position.x - b.position.x
  const dy = a.position.y - b.position.y
  const dz = a.position.z - b.position.z
  return dx * dx + dy * dy + dz * dz <= tol * tol
}

export const MAX_PICKS = 8
export const MAX_REGIONS = 5
export const MAX_REGION_VERTS = 64
export const MIN_REGION_VERTS = 3
export const MIN_REGION_AREA_MM2 = 1

export type InteractionMode = "pick" | "region"
export type RegionTool = "face" | "rect" | "freehand"

export type RegionInfo = {
  id: string
  part: string
  partIndex: number
  faceId: number
  faceType: string | null
  boundary: Vec3[]
  normal: Vec3
  centroid: Vec3
  approximation: "plane-projected" | "mesh-samples"
  kind?: "face" | "freehand" | "rect"
  size?: {
    width_mm: number
    height_mm: number
    quality: "mesh-approx" | "construction"
    frame: "viewer-plane"
  }
  plane?: {
    origin: Vec3
    xAxis: Vec3
    yAxis: Vec3
    boundary2d: Vec2[]
  }
}

export type RegionDraft = {
  active: boolean
  pointCount: number
  part: string | null
  faceId: number | null
  tool?: RegionTool
  width_mm?: number | null
  height_mm?: number | null
}

export type LoadPart = {
  name: string
  url: string
  color: number
  topoUrl?: string
}

export type SceneHandle = {
  parts: Array<{ name: string; visible: boolean; origColor: number }>
  fitCamera: () => void
  resize: () => void
  setPartVisible: (index: number, visible: boolean) => void
  setInteractionMode: (mode: InteractionMode) => void
  setRegionTool: (tool: RegionTool) => void
  setLinkArmed: (armed: boolean) => void
  clearPicks: () => void
  clearRegions: () => void
  getPicks: () => ClickInfo[]
  getRegions: () => RegionInfo[]
  getLinkedPairs: () => LinkedPinPair[]
  getLinkArmed: () => boolean
  getLinkFromId: () => string | null
  commitRegion: () => boolean
  cancelRegionStroke: () => void
  /** Resize a committed rect region (center fixed). Sets size.quality=construction. */
  setRegionRectSize: (id: string, width_mm: number, height_mm: number) => boolean
}
