import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import type {
  ClickInfo,
  InteractionMode,
  LinkedPinPair,
  LoadPart,
  PartTopo,
  RegionDraft,
  RegionInfo,
  RegionTool,
  Vec3,
} from "./assembly-types"
import {
  MAX_PICKS,
  MAX_REGION_VERTS,
  MAX_REGIONS,
  MIN_REGION_AREA_MM2,
  MIN_REGION_VERTS,
  picksMatch,
} from "./assembly-types"
import {
  axisAlignedRect2d,
  type EdgeOffsetGuide,
  MAX_LINKED_PAIRS,
  nearestEdgeOffsets,
  pointsNearPlane,
  axisAlignedRectCentered,
  rectCenter2d,
  rectMeetsMinSize,
  undirectedPairExists,
} from "./measure-geometry"
import { dominantDirection } from "./geometry"
import {
  buildPlaneFrame,
  centroid3,
  ensureCcw2d,
  fromPlane2d,
  nearStartScreen,
  orderBoundaryRing,
  polygonArea2d,
  roundVec2,
  roundVec3,
  simplify2d,
  simplify3d,
  toPlane2d,
  type PlaneFrame,
} from "./region-geometry"
import {
  boundaryEdgesFromTriangles,
  CENTER_SNAP_PX,
  dedupeVertices,
  EDGE_SNAP_PX,
  faceCentroid,
  resolveMeshSnap,
  VERTEX_SNAP_PX,
  type SnapIndex,
} from "./snap-geometry"

export type { ClickInfo, LoadPart }

export type ScenePart = {
  name: string
  group: THREE.Group
  visible: boolean
  origColor: number
  meshCount: number
  topo: PartTopo | null
}

type MeshHit = {
  point: THREE.Vector3
  normal: THREE.Vector3
  part: ScenePart
  partIndex: number
  faceId: number | null
  faceType: string | null
  triangleIndex: number | null
  mesh: THREE.Mesh
}

type RegionLock = {
  partIndex: number
  partName: string
  faceId: number
  faceType: string | null
  normal: THREE.Vector3
  origin: THREE.Vector3
  meshes: THREE.Mesh[]
  frame: PlaneFrame | null
}

const TAP_MOVE_PX = 10
/** Hold before pick-drag arms (touch-friendly snap preview). */
const PICK_HOLD_MS = 160
/** Move farther than this before hold → treat as orbit, cancel pick-drag. */
const PICK_ORBIT_SLOP_PX = 12
const TOUCH_SNAP_SCALE = 1.4
const SAMPLE_MIN_DIST = 0.15
const REGION_BIAS = 0.06
/** Screen-space snap-to-close radius (CSS px). Tight enough to avoid early close. */
const CLOSE_START_PX = 28
/** Don't auto-close until the stroke has enough samples / travel. */
const MIN_CLOSE_POINTS = 16
const MIN_CLOSE_PATH_MM = 14
/** High-contrast ink (not amber — amber is face highlight). */
const REGION_INK = 0x22d3ee
const REGION_INK_HALO = 0x0b1220
const REGION_FILL = 0x22d3ee

export class AssemblyScene {
  readonly parts: ScenePart[] = []
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000)
  private readonly renderer: THREE.WebGLRenderer
  private readonly controls: OrbitControls
  private readonly loader = new GLTFLoader()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly container: HTMLElement
  private frame = 0
  private disposed = false
  private loadGeneration = 0
  private pointerDown: { x: number; y: number; id: number } | null = null
  private multiTouchActive = false
  /** Pick long-press → drag with live snap preview (touch). */
  private pickGesture: {
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    pointerType: string
    armed: boolean
    cancelled: boolean
    holdTimer: ReturnType<typeof setTimeout> | null
  } | null = null
  private snapPreview: {
    clientX: number
    clientY: number
    world: Vec3
    snap: string
    edgeGuides: EdgeOffsetGuide[]
  } | null = null
  private picks: ClickInfo[] = []
  private pins: THREE.Group[] = []
  private pinIdSeq = 0
  private linkedPairs: LinkedPinPair[] = []
  private linkArmed = false
  private linkFromId: string | null = null
  private readonly measureOverlay = new THREE.Group()
  private readonly pinUp = new THREE.Vector3(0, 1, 0)
  private readonly pinNormal = new THREE.Vector3()
  private readonly pinQuat = new THREE.Quaternion()
  private interactionMode: InteractionMode = "pick"
  private regionTool: RegionTool = "face"
  private regions: RegionInfo[] = []
  private regionLock: RegionLock | null = null
  private stroke: THREE.Vector3[] = []
  private strokePathMm = 0
  /** Must leave the start snap zone before re-entry can close (avoids instant auto-close). */
  private strokeLeftStart = false
  private drawing = false
  private drawPointerId: number | null = null
  private strokeStartClient: { x: number; y: number } | null = null
  /** Rect opposite corners in world mm (plane-projected). */
  private rectCorner0: THREE.Vector3 | null = null
  private rectCorner1: THREE.Vector3 | null = null
  /** Screen-space live stroke (always visible while drawing; WebGL fat lines are unreliable mid-gesture). */
  private readonly drawCanvas: HTMLCanvasElement
  private readonly drawCtx: CanvasRenderingContext2D
  private readonly regionOverlay = new THREE.Group()
  private regionIdSeq = 0
  /** Lazy face-local snap index. Cleared on load. */
  private readonly faceSnapCache = new Map<string, SnapIndex>()
  private readonly snapProjectVec = new THREE.Vector3()
  private readonly snapAttrVec = new THREE.Vector3()

  onPicksChange: ((picks: ClickInfo[]) => void) | null = null
  onLinkedPairsChange: ((pairs: LinkedPinPair[], meta: { armed: boolean; fromId: string | null }) => void) | null =
    null
  onRegionsChange: ((regions: RegionInfo[]) => void) | null = null
  onRegionDraftChange: ((draft: RegionDraft | null) => void) | null = null
  onMessage: ((message: string) => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.scene.background = new THREE.Color(0x0b0d10)
    this.camera.position.set(120, 100, 160)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    this.renderer.shadowMap.enabled = true
    const canvas = this.renderer.domElement
    canvas.style.display = "block"
    canvas.style.width = "100%"
    canvas.style.height = "100%"
    canvas.style.touchAction = "none"
    canvas.style.userSelect = "none"
    canvas.setAttribute("draggable", "false")
    container.style.userSelect = "none"
    container.style.touchAction = "none"
    // Parent is already `absolute inset-0` (positioning context). Do not set
    // inline position:relative — that overrides absolute and collapses height.
    container.appendChild(canvas)

    this.drawCanvas = document.createElement("canvas")
    this.drawCanvas.setAttribute("aria-hidden", "true")
    this.drawCanvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;touch-action:none"
    container.appendChild(this.drawCanvas)
    const ctx = this.drawCanvas.getContext("2d")
    if (!ctx) throw new Error("2d canvas unavailable")
    this.drawCtx = ctx

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.set(0, 0, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    this.controls.update()

    this.scene.add(new THREE.AmbientLight(0x404060, 0.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.5)
    key.position.set(80, 120, 60)
    key.castShadow = true
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x8888ff, 0.6)
    fill.position.set(-60, 40, -80)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 0.4)
    rim.position.set(0, -60, 100)
    this.scene.add(rim)
    this.scene.add(new THREE.GridHelper(200, 20, 0x333344, 0x222233))

    this.regionOverlay.name = "__regions"
    this.regionOverlay.raycast = () => {}
    this.regionOverlay.renderOrder = 9
    this.scene.add(this.regionOverlay)
    this.measureOverlay.name = "__measures"
    this.measureOverlay.raycast = () => {}
    this.measureOverlay.renderOrder = 10
    this.scene.add(this.measureOverlay)

    canvas.addEventListener("pointerdown", this.handlePointerDown, { capture: true, passive: false })
    canvas.addEventListener("pointermove", this.handlePointerMove, { capture: true, passive: false })
    canvas.addEventListener("pointerup", this.handlePointerUp, true)
    canvas.addEventListener("pointercancel", this.handlePointerCancel, true)
    canvas.addEventListener("pointerleave", this.handlePointerLeave, true)
    canvas.addEventListener("contextmenu", this.handleContextMenu, true)
    canvas.addEventListener("selectstart", this.handleSelectStart, true)
    canvas.addEventListener("gesturestart", this.handleGestureBlock as EventListener, true)
    this.resize()
    this.animate()
  }

  private handleContextMenu = (event: Event) => {
    event.preventDefault()
  }

  private handleSelectStart = (event: Event) => {
    event.preventDefault()
  }

  private handleGestureBlock = (event: Event) => {
    // iOS Safari pinch/long-press gesture noise on canvas
    event.preventDefault()
  }

  private handlePointerLeave = () => {
    if (this.pickGesture) return
    if (this.snapPreview) {
      this.snapPreview = null
      this.paintDrawOverlay()
    }
  }

  resize = () => {
    if (this.disposed) return
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    const dpr = Math.min(devicePixelRatio, 2)
    this.drawCanvas.width = Math.max(1, Math.floor(w * dpr))
    this.drawCanvas.height = Math.max(1, Math.floor(h * dpr))
    this.drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.regionOverlay.traverse((obj) => {
      if (obj instanceof Line2 && obj.material instanceof LineMaterial) {
        obj.material.resolution.set(w, h)
      }
    })
    this.measureOverlay.traverse((obj) => {
      if (obj instanceof Line2 && obj.material instanceof LineMaterial) {
        obj.material.resolution.set(w, h)
      }
    })
    this.paintDrawOverlay()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    const canvas = this.renderer.domElement
    canvas.removeEventListener("pointerdown", this.handlePointerDown, true)
    canvas.removeEventListener("pointermove", this.handlePointerMove, true)
    canvas.removeEventListener("pointerup", this.handlePointerUp, true)
    canvas.removeEventListener("pointercancel", this.handlePointerCancel, true)
    canvas.removeEventListener("pointerleave", this.handlePointerLeave, true)
    canvas.removeEventListener("contextmenu", this.handleContextMenu, true)
    canvas.removeEventListener("selectstart", this.handleSelectStart, true)
    canvas.removeEventListener("gesturestart", this.handleGestureBlock as EventListener, true)
    this.cancelPickGesture()
    this.clear()
    this.disposePins()
    this.disposeRegionOverlays()
    this.disposeMeasureOverlays()
    this.drawCanvas.remove()
    this.controls.dispose()
    this.renderer.dispose()
    canvas.remove()
  }

  clear() {
    this.loadGeneration += 1
    this.faceSnapCache.clear()
    this.clearPicks(false)
    this.clearRegions(false)
    this.cancelRegionStroke(false)
    for (const part of this.parts) {
      this.scene.remove(part.group)
      part.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose()
          if (Array.isArray(child.material)) {
            for (const material of child.material) material.dispose()
          } else {
            child.material?.dispose()
          }
        }
      })
    }
    this.parts.length = 0
  }

  getPicks = () => this.picks.slice()
  getRegions = () => this.regions.slice()
  getLinkedPairs = () => this.linkedPairs.slice()
  getLinkArmed = () => this.linkArmed
  getLinkFromId = () => this.linkFromId

  setInteractionMode = (mode: InteractionMode) => {
    if (this.interactionMode === mode) return
    this.cancelRegionStroke(true)
    this.cancelPickGesture()
    this.interactionMode = mode
    if (mode !== "pick") this.setLinkArmed(false)
    this.applyControlsForMode()
    this.emitDraft()
  }

  setRegionTool = (tool: RegionTool) => {
    if (this.regionTool === tool) return
    this.cancelRegionStroke(true)
    this.regionTool = tool
    if (tool === "face" && this.snapPreview) {
      this.snapPreview = null
      this.paintDrawOverlay()
    }
    this.emitDraft()
  }

  setLinkArmed = (armed: boolean) => {
    this.linkArmed = armed
    if (!armed) this.linkFromId = null
    this.emitLinkedPairs()
  }

  clearPicks = (emit = true) => {
    this.picks = []
    this.linkedPairs = []
    this.linkFromId = null
    this.linkArmed = false
    this.syncPins()
    this.rebuildMeasureOverlays()
    this.applySelectionColors()
    if (emit) {
      this.onPicksChange?.([])
      this.emitLinkedPairs()
    }
  }

  clearRegions = (emit = true) => {
    this.cancelRegionStroke(emit)
    this.regions = []
    this.disposeRegionOverlays()
    this.applySelectionColors()
    if (emit) this.onRegionsChange?.([])
  }

  commitRegion = (): boolean => {
    if (!this.regionLock || this.stroke.length < MIN_REGION_VERTS) {
      this.onMessage?.("Draw a closed area first")
      return false
    }
    const ok = this.tryCommitRegion()
    if (!ok) this.cancelRegionStroke(true)
    return ok
  }

  /** Center-fixed resize of a committed rect; typed size → construction quality. */
  setRegionRectSize = (id: string, width_mm: number, height_mm: number): boolean => {
    const idx = this.regions.findIndex((r) => r.id === id)
    if (idx < 0) return false
    const region = this.regions[idx]!
    if (region.kind !== "rect" || !region.plane || !region.size) return false
    if (!Number.isFinite(width_mm) || !Number.isFinite(height_mm)) return false
    // Same size → no-op (do not flip quality on focus/blur alone).
    if (Math.abs(width_mm - region.size.width_mm) < 1e-3 && Math.abs(height_mm - region.size.height_mm) < 1e-3) {
      return true
    }
    if (!rectMeetsMinSize(width_mm, height_mm, MIN_REGION_AREA_MM2)) {
      this.onMessage?.("Region too small")
      return false
    }
    const center = rectCenter2d(region.plane.boundary2d)
    const rect = axisAlignedRectCentered(center, width_mm, height_mm)
    const frame = {
      origin: region.plane.origin,
      normal: region.normal,
      xAxis: region.plane.xAxis,
      yAxis: region.plane.yAxis,
    }
    const boundary2d = rect.boundary2d.map(roundVec2)
    const boundary = boundary2d.map((p) => roundVec3(fromPlane2d(p, frame)))
    this.regions[idx] = {
      ...region,
      boundary,
      centroid: roundVec3(centroid3(boundary)),
      size: {
        width_mm: +width_mm.toFixed(3),
        height_mm: +height_mm.toFixed(3),
        quality: "construction",
        frame: "viewer-plane",
      },
      plane: {
        ...region.plane,
        boundary2d,
      },
    }
    this.rebuildRegionOverlays()
    this.emitRegions()
    return true
  }

  cancelRegionStroke = (emit = true) => {
    this.endDrawGesture()
    this.regionLock = null
    this.stroke = []
    this.strokePathMm = 0
    this.strokeLeftStart = false
    this.rectCorner0 = null
    this.rectCorner1 = null
    this.clearDrawOverlay()
    this.applyControlsForMode()
    this.applySelectionColors()
    if (emit) this.emitDraft()
  }

  private applyControlsForMode() {
    if (this.interactionMode === "region" && this.regionLock) {
      this.controls.mouseButtons = {
        LEFT: -1 as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      }
      this.controls.touches = {
        ONE: -1 as unknown as THREE.TOUCH,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }
    } else {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }
      this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    }
    if (!this.drawing) this.controls.enabled = true
  }

  private endDrawGesture() {
    this.drawing = false
    this.drawPointerId = null
    this.strokeStartClient = null
    this.controls.enabled = true
  }

  private createPin(): THREE.Group {
    const group = new THREE.Group()
    group.name = "__pick_pin"
    group.visible = false

    const amber = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    })
    const white = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: false,
    })
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    })

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.42, 36), ringMat)
    ring.rotation.x = -Math.PI / 2
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), white)
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.15, 10), amber)
    stem.position.y = 0.58
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 14), amber)
    head.position.y = 1.28
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 16, 14),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.22, depthWrite: false }),
    )
    halo.position.y = 1.28

    group.add(ring, tip, stem, head, halo)
    group.traverse((obj) => {
      obj.raycast = () => {}
    })
    this.scene.add(group)
    return group
  }

  private disposePins() {
    for (const pin of this.pins) {
      this.scene.remove(pin)
      pin.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose()
          if (Array.isArray(child.material)) {
            for (const material of child.material) material.dispose()
          } else {
            child.material?.dispose()
          }
        }
      })
    }
    this.pins = []
  }

  private disposeRegionOverlays() {
    while (this.regionOverlay.children.length > 0) {
      const child = this.regionOverlay.children[0]!
      this.regionOverlay.remove(child)
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry?.dispose()
          if (Array.isArray(obj.material)) {
            for (const material of obj.material) material.dispose()
          } else {
            ;(obj.material as THREE.Material | undefined)?.dispose()
          }
        }
      })
    }
  }

  private syncPins() {
    while (this.pins.length < this.picks.length) this.pins.push(this.createPin())
    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i]!
      const pick = this.picks[i]
      if (!pick) {
        pin.visible = false
        continue
      }
      this.pinNormal.set(pick.normal.x, pick.normal.y, pick.normal.z).normalize()
      if (this.pinNormal.lengthSq() < 1e-8) this.pinNormal.set(0, 1, 0)
      pin.position.set(pick.position.x, pick.position.y, pick.position.z).addScaledVector(this.pinNormal, 0.04)
      this.pinQuat.setFromUnitVectors(this.pinUp, this.pinNormal)
      pin.quaternion.copy(this.pinQuat)
      pin.visible = true
    }
    this.updatePinScales()
  }

  private applySelectionColors() {
    const selectedParts = new Set<number>()
    const selectedFaces = new Set<string>()
    for (const p of this.picks) {
      selectedParts.add(p.partIndex)
      if (p.faceId !== null) selectedFaces.add(`${p.partIndex}:${p.faceId}`)
    }
    for (const r of this.regions) {
      selectedParts.add(r.partIndex)
      selectedFaces.add(`${r.partIndex}:${r.faceId}`)
    }
    if (this.regionLock) {
      selectedParts.add(this.regionLock.partIndex)
      selectedFaces.add(`${this.regionLock.partIndex}:${this.regionLock.faceId}`)
    }

    for (let partIndex = 0; partIndex < this.parts.length; partIndex++) {
      const part = this.parts[partIndex]!
      const partSelected = selectedParts.has(partIndex)
      part.group.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial)) return
        const meshFaceId = typeof child.userData.faceId === "number" ? (child.userData.faceId as number) : null
        const faceKey = meshFaceId !== null ? `${partIndex}:${meshFaceId}` : null
        if (faceKey && selectedFaces.has(faceKey)) {
          child.material.color.setHex(0xfbbf24)
          child.material.emissive?.setHex(0x4a3000)
          child.material.emissiveIntensity = 0.25
        } else if (partSelected) {
          child.material.color.setHex(0xffc4a8)
          child.material.emissive?.setHex(0x000000)
          child.material.emissiveIntensity = 0
        } else {
          child.material.color.setHex(part.origColor)
          child.material.emissive?.setHex(0x000000)
          child.material.emissiveIntensity = 0
        }
      })
    }
  }

  private updatePinScales() {
    for (const pin of this.pins) {
      if (!pin.visible) continue
      const dist = this.camera.position.distanceTo(pin.position)
      pin.scale.setScalar(THREE.MathUtils.clamp(dist * 0.02, 0.45, 18))
    }
  }

  private emitPicks() {
    this.onPicksChange?.(this.picks.slice())
  }

  private emitLinkedPairs() {
    this.onLinkedPairsChange?.(this.linkedPairs.slice(), {
      armed: this.linkArmed,
      fromId: this.linkFromId,
    })
  }

  private emitRegions() {
    this.onRegionsChange?.(this.regions.slice())
  }

  private emitDraft() {
    if (this.interactionMode !== "region") {
      this.onRegionDraftChange?.(null)
      return
    }
    const rectActive = this.regionTool === "rect" && this.rectCorner0 !== null
    if (!this.regionLock && this.stroke.length === 0 && !rectActive) {
      this.onRegionDraftChange?.(null)
      return
    }
    let width_mm: number | null = null
    let height_mm: number | null = null
    if (rectActive && this.regionLock?.frame && this.rectCorner0 && this.rectCorner1) {
      const a = toPlane2d({ x: this.rectCorner0.x, y: this.rectCorner0.y, z: this.rectCorner0.z }, this.regionLock.frame)
      const b = toPlane2d({ x: this.rectCorner1.x, y: this.rectCorner1.y, z: this.rectCorner1.z }, this.regionLock.frame)
      const rect = axisAlignedRect2d(a, b)
      width_mm = rect.width_mm
      height_mm = rect.height_mm
    }
    this.onRegionDraftChange?.({
      active: this.drawing || this.stroke.length > 0 || this.regionLock !== null || rectActive,
      pointCount: this.regionTool === "rect" ? (this.rectCorner0 ? 2 : 0) : this.stroke.length,
      part: this.regionLock?.partName ?? null,
      faceId: this.regionLock?.faceId ?? null,
      tool: this.regionTool,
      width_mm,
      height_mm,
    })
  }

  private async loadTopo(url: string | undefined): Promise<PartTopo | null> {
    if (!url) return null
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const data = (await response.json()) as PartTopo
      if (data?.schema !== 1 || !Array.isArray(data.triangleFaceIds)) return null
      return data
    } catch {
      return null
    }
  }

  fitCamera() {
    if (this.disposed) return
    this.resize()
    this.scene.updateMatrixWorld(true)

    const box = new THREE.Box3()
    let hasGeo = false
    for (const part of this.parts) {
      if (!part.visible) continue
      box.expandByObject(part.group)
      hasGeo = true
    }
    if (!hasGeo || box.isEmpty()) return

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(sphere.radius, 0.5)
    const maxDim = Math.max(size.x, size.y, size.z, 1)

    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const fitOffset = 1.4
    let distance = (radius * fitOffset) / Math.sin(fov / 2)
    const aspect = Math.max(this.camera.aspect, 0.01)
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect)
    distance = Math.max(distance, (radius * fitOffset) / Math.sin(hFov / 2))
    distance = Math.max(distance, maxDim * 1.1)

    let dir = this.camera.position.clone().sub(this.controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(0.75, 0.55, 1)
    dir.normalize()

    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(dir, distance)
    this.camera.near = Math.max(distance / 200, 0.01)
    this.camera.far = Math.max(distance * 50, maxDim * 20, 100)
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(center)
    this.controls.update()

    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.enableDamping = damping
    this.renderer.render(this.scene, this.camera)
  }

  setPartVisible(index: number, visible: boolean) {
    const part = this.parts[index]
    if (!part) return
    part.visible = visible
    part.group.visible = visible
  }

  private loadGLB(url: string, partName: string, color: number) {
    return new Promise<THREE.Group | null>((resolve) => {
      this.loader.load(
        url,
        (gltf) => {
          const group = new THREE.Group()
          group.name = partName
          gltf.scene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return
            const match = /(?:^|[_-])face[_-]?(\d+)$/i.exec(child.name)
            if (match) child.userData.faceId = Number(match[1])
            child.material = new THREE.MeshStandardMaterial({
              color,
              metalness: 0.15,
              roughness: 0.6,
              emissive: 0x000000,
              emissiveIntensity: 0,
            })
            child.receiveShadow = true
            child.castShadow = true
          })
          group.add(gltf.scene)
          resolve(group)
        },
        undefined,
        () => resolve(null),
      )
    })
  }

  async loadParts(items: LoadPart[]) {
    // clear() bumps loadGeneration — capture AFTER so this load is not treated as stale.
    this.clear()
    const generation = this.loadGeneration
    const loadedParts = await Promise.all(
      items.map(async (item) => {
        const [geometry, topo] = await Promise.all([this.loadGLB(item.url, item.name, item.color), this.loadTopo(item.topoUrl)])
        return { item, geometry, topo }
      }),
    )
    if (generation !== this.loadGeneration || this.disposed) {
      for (const entry of loadedParts) {
        entry.geometry?.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose()
            if (Array.isArray(child.material)) {
              for (const material of child.material) material.dispose()
            } else {
              child.material?.dispose()
            }
          }
        })
      }
      return { loaded: 0, failed: items.length }
    }

    let loaded = 0
    for (const { item, geometry, topo } of loadedParts) {
      if (!geometry) continue
      geometry.visible = true
      this.scene.add(geometry)
      const entry: ScenePart = {
        name: item.name,
        group: geometry,
        visible: true,
        origColor: item.color,
        meshCount: 0,
        topo,
      }
      geometry.traverse((child) => {
        if (child instanceof THREE.Mesh) entry.meshCount += 1
      })
      this.parts.push(entry)
      loaded += 1
    }
    requestAnimationFrame(() => {
      if (generation !== this.loadGeneration || this.disposed) return
      this.fitCamera()
    })
    return { loaded, failed: items.length - loaded }
  }

  private collectMeshes(filter?: { partIndex: number; faceId: number }): Array<{ mesh: THREE.Mesh; part: ScenePart; partIndex: number }> {
    const meshes: Array<{ mesh: THREE.Mesh; part: ScenePart; partIndex: number }> = []
    for (let partIndex = 0; partIndex < this.parts.length; partIndex++) {
      const part = this.parts[partIndex]!
      if (!part.visible) continue
      if (filter && partIndex !== filter.partIndex) continue
      part.group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        if (filter) {
          const faceId = typeof child.userData.faceId === "number" ? (child.userData.faceId as number) : null
          if (faceId !== filter.faceId) return
        }
        meshes.push({ mesh: child, part, partIndex })
      })
    }
    return meshes
  }

  private setRayFromClient(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return true
  }

  private hitAt(clientX: number, clientY: number, filter?: { partIndex: number; faceId: number }): MeshHit | null {
    if (!this.setRayFromClient(clientX, clientY)) return null
    const meshes = this.collectMeshes(filter)
    if (meshes.length === 0) return null
    const hits = this.raycaster.intersectObjects(
      meshes.map((entry) => entry.mesh),
      false,
    )
    if (hits.length === 0) return null
    const hit = hits[0]!
    const hitInfo = meshes.find((entry) => entry.mesh === hit.object)
    if (!hitInfo) return null
    const normal = (hit.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone()
    normal.transformDirection(hit.object.matrixWorld)
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate()

    const triangleIndex = typeof hit.faceIndex === "number" ? hit.faceIndex : null
    let faceId: number | null = null
    let faceType: string | null = null
    if (hit.object instanceof THREE.Mesh && typeof hit.object.userData.faceId === "number") {
      faceId = hit.object.userData.faceId as number
    } else if (triangleIndex !== null && hitInfo.part.topo) {
      const mapped = hitInfo.part.topo.triangleFaceIds[triangleIndex]
      if (typeof mapped === "number") faceId = mapped
    }
    if (faceId !== null && hitInfo.part.topo) {
      faceType = hitInfo.part.topo.faces.find((face) => face.id === faceId)?.type ?? null
    }

    return {
      point: hit.point.clone(),
      normal,
      part: hitInfo.part,
      partIndex: hitInfo.partIndex,
      faceId,
      faceType,
      triangleIndex,
      mesh: hitInfo.mesh,
    }
  }

  private faceMeshes(partIndex: number, faceId: number): THREE.Mesh[] {
    return this.collectMeshes({ partIndex, faceId }).map((entry) => entry.mesh)
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return
    if (!event.isPrimary) {
      this.multiTouchActive = true
      this.pointerDown = null
      this.cancelPickGesture()
      // Second finger while drawing: full cancel — half endDrawGesture left lock+stroke stuck.
      if (this.drawing || (this.regionLock && (this.stroke.length > 0 || this.rectCorner0))) {
        try {
          if (this.drawPointerId !== null) this.renderer.domElement.releasePointerCapture(this.drawPointerId)
        } catch {
          /* ignore */
        }
        this.cancelRegionStroke(true)
      }
      return
    }
    if (this.multiTouchActive) return
    this.pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId }

    if (this.interactionMode === "pick" && this.parts.length > 0) {
      this.beginPickGesture(event)
      return
    }

    if (this.interactionMode !== "region" || this.parts.length === 0) return

    // Face: tap-to-commit on pointerup (same orbit-friendly path as pick).
    if (this.regionTool === "face") return

    if (this.regionTool === "rect") {
      if (this.drawing) return
      this.beginRectGesture(event)
      return
    }

    // Freehand: one continuous gesture only — incomplete strokes discarded on lift.
    if (this.regionLock && this.stroke.length > 0) return

    if (this.regionLock) {
      const hit = this.hitAt(event.clientX, event.clientY, {
        partIndex: this.regionLock.partIndex,
        faceId: this.regionLock.faceId,
      })
      if (!hit) return
      this.beginDraw(event, hit.point)
      return
    }

    const hit = this.hitAt(event.clientX, event.clientY)
    if (!hit) return
    if (hit.faceId === null) {
      this.onMessage?.("Region needs face-split mesh (built design)")
      return
    }
    if (this.regions.length >= MAX_REGIONS) {
      this.onMessage?.(`Max ${MAX_REGIONS} regions`)
      return
    }
    this.lockFace(hit)
    this.beginDraw(event, hit.point)
  }

  private beginRectGesture(event: PointerEvent) {
    const hit = this.hitAt(event.clientX, event.clientY)
    if (!hit) return
    if (hit.faceId === null) {
      this.onMessage?.("Region needs face-split mesh (built design)")
      return
    }
    if (!this.faceIsRectEligible(hit)) {
      this.onMessage?.(
        hit.faceType && hit.faceType !== "plane"
          ? `Rect needs a planar face (this is ${hit.faceType})`
          : "Rect needs a planar face",
      )
      return
    }
    if (this.regions.length >= MAX_REGIONS) {
      this.onMessage?.(`Max ${MAX_REGIONS} regions`)
      return
    }
    const snapped = this.snapFacePoint(hit, event.clientX, event.clientY, event.pointerType)
    const point = new THREE.Vector3(snapped.x, snapped.y, snapped.z)
    this.lockFace({ ...hit, point }, { forcePlane: true })
    if (!this.regionLock?.frame) {
      this.cancelRegionStroke(true)
      this.onMessage?.("Rect needs a planar face")
      return
    }
    this.rectCorner0 = point.clone()
    this.rectCorner1 = point.clone()
    this.drawing = true
    this.drawPointerId = event.pointerId
    this.controls.enabled = false
    event.stopPropagation()
    event.preventDefault()
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    this.updateSnapPreviewAt(event.clientX, event.clientY, event.pointerType)
    this.paintDrawOverlay()
    this.emitDraft()
  }

  private snapFacePoint(hit: MeshHit, clientX: number, clientY: number, pointerType = "mouse"): Vec3 {
    const hitPos = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
    if (hit.faceId === null) return hitPos
    const th = this.snapThresholds(pointerType)
    const snapped = resolveMeshSnap(
      hitPos,
      clientX,
      clientY,
      this.getFaceSnapIndex(hit.partIndex, hit.faceId),
      (p) => this.projectClient(p),
      th.vertex,
      th.edge,
      th.center,
    )
    return snapped.position
  }

  /** Topo plane, or mesh verts near hit plane when topo type unknown. */
  private faceIsRectEligible(hit: MeshHit): boolean {
    if (hit.faceId === null) return false
    if (hit.faceType === "plane") return true
    if (hit.faceType !== null && hit.faceType !== undefined) return false
    const verts = this.getFaceSnapIndex(hit.partIndex, hit.faceId).vertices
    return pointsNearPlane(
      verts,
      { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    )
  }

  private lockFace(hit: MeshHit, opts?: { forcePlane?: boolean }) {
    const meshes = this.faceMeshes(hit.partIndex, hit.faceId!)
    const treatAsPlane = hit.faceType === "plane" || Boolean(opts?.forcePlane)
    const frame = treatAsPlane
      ? buildPlaneFrame(
          { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
        )
      : null
    this.regionLock = {
      partIndex: hit.partIndex,
      partName: hit.part.name,
      faceId: hit.faceId!,
      faceType: hit.faceType ?? (treatAsPlane ? "plane" : null),
      normal: hit.normal.clone(),
      origin: hit.point.clone(),
      meshes,
      frame,
    }
    this.stroke = []
    this.strokePathMm = 0
    this.strokeLeftStart = false
    this.applyControlsForMode()
    this.applySelectionColors()
    this.emitDraft()
  }

  private beginDraw(event: PointerEvent, point: THREE.Vector3) {
    this.drawing = true
    this.drawPointerId = event.pointerId
    this.strokeStartClient = { x: event.clientX, y: event.clientY }
    this.strokePathMm = 0
    this.strokeLeftStart = false
    this.controls.enabled = false
    event.stopPropagation()
    event.preventDefault()
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    this.appendStroke(point, event.clientX, event.clientY)
  }

  private handlePointerMove = (event: PointerEvent) => {
    if (this.multiTouchActive) return

    // Mouse hover snap ghost — Pick + Region (not Face: whole-face select, no point snap).
    if (
      (this.interactionMode === "pick" ||
        (this.interactionMode === "region" && !this.drawing && this.regionTool !== "face")) &&
      event.pointerType === "mouse" &&
      event.buttons === 0 &&
      !this.pickGesture &&
      this.parts.length > 0
    ) {
      this.updateSnapPreviewAt(event.clientX, event.clientY, "mouse")
      this.paintDrawOverlay()
      return
    }

    if (this.pickGesture && event.pointerId === this.pickGesture.pointerId) {
      this.pickGesture.lastX = event.clientX
      this.pickGesture.lastY = event.clientY
      const dx = event.clientX - this.pickGesture.startX
      const dy = event.clientY - this.pickGesture.startY
      const distSq = dx * dx + dy * dy
      if (!this.pickGesture.armed) {
        if (distSq > PICK_ORBIT_SLOP_PX * PICK_ORBIT_SLOP_PX) {
          // Early move = orbit; drop pick tracking so controls keep the gesture.
          this.cancelPickGesture()
        }
        // Do not preventDefault — OrbitControls is driving.
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.updateSnapPreviewAt(event.clientX, event.clientY, this.pickGesture.pointerType)
      this.paintDrawOverlay()
      return
    }

    if (!this.drawing || event.pointerId !== this.drawPointerId || !this.regionLock) return
    const hit = this.hitAt(event.clientX, event.clientY, {
      partIndex: this.regionLock.partIndex,
      faceId: this.regionLock.faceId,
    })
    if (!hit) return
    if (this.regionTool === "rect") {
      const snapped = this.snapFacePoint(hit, event.clientX, event.clientY, event.pointerType)
      this.rectCorner1 = new THREE.Vector3(snapped.x, snapped.y, snapped.z)
      this.updateSnapPreviewAt(event.clientX, event.clientY, event.pointerType)
      this.paintDrawOverlay()
      this.emitDraft()
      return
    }
    this.appendStroke(hit.point, event.clientX, event.clientY)
  }

  private appendStroke(point: THREE.Vector3, clientX?: number, clientY?: number) {
    const last = this.stroke[this.stroke.length - 1]
    if (last && last.distanceTo(point) < SAMPLE_MIN_DIST) {
      this.updateCloseGate(clientX, clientY)
      if (this.canCloseStroke(clientX, clientY)) this.finishClosedStroke()
      return
    }
    if (last) this.strokePathMm += last.distanceTo(point)
    this.stroke.push(point.clone())
    this.syncStrokeLine()
    this.emitDraft()
    this.updateCloseGate(clientX, clientY)
    if (this.canCloseStroke(clientX, clientY)) this.finishClosedStroke()
  }

  /** Track leaving the start zone so we only close on re-entry, not at stroke start. */
  private updateCloseGate(clientX?: number, clientY?: number) {
    if (this.strokeLeftStart || this.stroke.length === 0) return
    const firstScreen = this.clientOfWorld(this.stroke[0]!)
    if (!firstScreen) return
    const nearPointer =
      clientX !== undefined &&
      clientY !== undefined &&
      nearStartScreen(clientX - firstScreen.x, clientY - firstScreen.y, CLOSE_START_PX)
    const last = this.stroke[this.stroke.length - 1]!
    const lastScreen = this.clientOfWorld(last)
    const nearLast =
      lastScreen !== null && nearStartScreen(lastScreen.x - firstScreen.x, lastScreen.y - firstScreen.y, CLOSE_START_PX)
    if (!nearPointer && !nearLast) this.strokeLeftStart = true
  }

  /**
   * Close only after: left start zone → came back near start, with enough path.
   * Prevents auto-close while the stroke is still beginning near the lock point.
   */
  private canCloseStroke(clientX?: number, clientY?: number): boolean {
    if (!this.strokeLeftStart) return false
    if (this.stroke.length < MIN_REGION_VERTS) return false
    if (this.stroke.length < MIN_CLOSE_POINTS || this.strokePathMm < MIN_CLOSE_PATH_MM) return false
    const first = this.stroke[0]
    if (!first) return false
    const firstScreen = this.clientOfWorld(first)
    if (!firstScreen) return false

    if (clientX !== undefined && clientY !== undefined) {
      if (nearStartScreen(clientX - firstScreen.x, clientY - firstScreen.y, CLOSE_START_PX)) return true
    }
    const last = this.stroke[this.stroke.length - 1]!
    const lastScreen = this.clientOfWorld(last)
    if (lastScreen && nearStartScreen(lastScreen.x - firstScreen.x, lastScreen.y - firstScreen.y, CLOSE_START_PX)) {
      return true
    }
    return false
  }

  private finishClosedStroke() {
    if (!this.drawing && this.stroke.length < MIN_REGION_VERTS) return
    try {
      if (this.drawPointerId !== null) this.renderer.domElement.releasePointerCapture(this.drawPointerId)
    } catch {
      /* ignore */
    }
    this.pointerDown = null
    this.endDrawGesture()
    this.applyControlsForMode()
    // Failed commit (too small / full / simplify) must unlock — else LMB orbit + redraw stick.
    if (!this.tryCommitRegion()) this.cancelRegionStroke(true)
  }

  private syncStrokeLine() {
    this.paintDrawOverlay()
  }

  private clearDrawOverlay() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.drawCtx.clearRect(0, 0, w, h)
  }

  /** Screen-space pill label (same language as snap edge mm guides). */
  private paintOverlayLabel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    color: string,
  ) {
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif"
    const tw = ctx.measureText(text).width
    ctx.globalAlpha = 1
    ctx.fillStyle = "rgba(11, 18, 32, 0.88)"
    ctx.fillRect(x - tw / 2 - 4, y - 9, tw + 8, 16)
    ctx.fillStyle = color
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, x, y)
  }

  private worldToOverlay(
    world: { x: number; y: number; z: number },
    canvasRect: DOMRect,
  ): { x: number; y: number } | null {
    const screen = this.clientOfWorld(new THREE.Vector3(world.x, world.y, world.z))
    if (!screen) return null
    return { x: screen.x - canvasRect.left, y: screen.y - canvasRect.top }
  }

  /** W on min-v edge midpoint, H on max-u edge midpoint (viewer-plane UV). */
  private paintRectSizeLabels(
    ctx: CanvasRenderingContext2D,
    canvasRect: DOMRect,
    frame: { origin: Vec3; xAxis: Vec3; yAxis: Vec3; normal?: Vec3 },
    boundary2d: ReadonlyArray<{ u: number; v: number }>,
    width_mm: number,
    height_mm: number,
    color = "#22d3ee",
  ) {
    if (boundary2d.length < 4) return
    let u0 = boundary2d[0]!.u
    let u1 = u0
    let v0 = boundary2d[0]!.v
    let v1 = v0
    for (const p of boundary2d) {
      u0 = Math.min(u0, p.u)
      u1 = Math.max(u1, p.u)
      v0 = Math.min(v0, p.v)
      v1 = Math.max(v1, p.v)
    }
    const plane = {
      origin: frame.origin,
      normal: frame.normal ?? { x: 0, y: 0, z: 1 },
      xAxis: frame.xAxis,
      yAxis: frame.yAxis,
    }
    const midW = this.worldToOverlay(fromPlane2d({ u: (u0 + u1) / 2, v: v0 }, plane), canvasRect)
    const midH = this.worldToOverlay(fromPlane2d({ u: u1, v: (v0 + v1) / 2 }, plane), canvasRect)
    if (midW) this.paintOverlayLabel(ctx, midW.x, midW.y, `W ${width_mm.toFixed(1)}`, color)
    if (midH) this.paintOverlayLabel(ctx, midH.x, midH.y, `H ${height_mm.toFixed(1)}`, color)
  }

  private needsDrawOverlay(): boolean {
    if (this.snapPreview) return true
    if (this.stroke.length >= 2) return true
    if (this.regionTool === "rect" && this.rectCorner0 && this.rectCorner1) return true
    return this.regions.some((r) => r.kind === "rect" && r.size && r.plane)
  }

  /** Project live stroke/rect/snap preview to screen pixels. */
  private paintDrawOverlay() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.drawCtx.clearRect(0, 0, w, h)

    const canvasRect = this.renderer.domElement.getBoundingClientRect()
    const ctx = this.drawCtx

    if (this.snapPreview) {
      const worldScreen = this.clientOfWorld(
        new THREE.Vector3(this.snapPreview.world.x, this.snapPreview.world.y, this.snapPreview.world.z),
      )
      const sx = (worldScreen?.x ?? this.snapPreview.clientX) - canvasRect.left
      const sy = (worldScreen?.y ?? this.snapPreview.clientY) - canvasRect.top
      const snapped = this.snapPreview.snap !== "free"
      const color = snapped ? "#fbbf24" : "#22d3ee"
      const r = snapped ? 14 : 10

      // Edge distance guides (nearest boundary edges on this face).
      for (const g of this.snapPreview.edgeGuides) {
        const footScreen = this.clientOfWorld(new THREE.Vector3(g.foot.x, g.foot.y, g.foot.z))
        if (!footScreen) continue
        const fx = footScreen.x - canvasRect.left
        const fy = footScreen.y - canvasRect.top
        ctx.beginPath()
        ctx.setLineDash([5, 4])
        ctx.moveTo(sx, sy)
        ctx.lineTo(fx, fy)
        ctx.strokeStyle = "#22d3ee"
        ctx.lineWidth = 1.75
        ctx.globalAlpha = 0.9
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(fx, fy, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = "#22d3ee"
        ctx.globalAlpha = 1
        ctx.fill()
        const mx = (sx + fx) * 0.5
        const my = (sy + fy) * 0.5
        this.paintOverlayLabel(ctx, mx, my, `${g.distance_mm.toFixed(1)} mm`, "#22d3ee")
      }

      ctx.beginPath()
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2)
      ctx.fillStyle = "#0b1220"
      ctx.globalAlpha = 0.75
      ctx.fill()
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      ctx.globalAlpha = 1
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(sx - r - 4, sy)
      ctx.lineTo(sx + r + 4, sy)
      ctx.moveTo(sx, sy - r - 4)
      ctx.lineTo(sx, sy + r + 4)
      ctx.stroke()
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif"
      ctx.fillStyle = color
      ctx.textAlign = "center"
      ctx.textBaseline = "alphabetic"
      const tag = snapped ? this.snapPreview.snap : "free"
      ctx.fillText(tag, sx, sy - r - 10)
    }

    if (this.regionTool === "rect" && this.rectCorner0 && this.rectCorner1 && this.regionLock?.frame) {
      const frame = this.regionLock.frame
      const a = toPlane2d({ x: this.rectCorner0.x, y: this.rectCorner0.y, z: this.rectCorner0.z }, frame)
      const b = toPlane2d({ x: this.rectCorner1.x, y: this.rectCorner1.y, z: this.rectCorner1.z }, frame)
      const rect = axisAlignedRect2d(a, b)
      const pts: Array<{ x: number; y: number }> = []
      for (const p2 of rect.boundary2d) {
        const world = fromPlane2d(p2, frame)
        const screen = this.clientOfWorld(new THREE.Vector3(world.x, world.y, world.z))
        if (!screen) continue
        pts.push({ x: screen.x - canvasRect.left, y: screen.y - canvasRect.top })
      }
      if (pts.length >= 4) {
        ctx.beginPath()
        ctx.moveTo(pts[0]!.x, pts[0]!.y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
        ctx.closePath()
        ctx.strokeStyle = "#22d3ee"
        ctx.lineWidth = 3.5
        ctx.globalAlpha = 1
        ctx.stroke()
        ctx.fillStyle = "rgba(34, 211, 238, 0.12)"
        ctx.fill()
        this.paintRectSizeLabels(ctx, canvasRect, frame, rect.boundary2d, rect.width_mm, rect.height_mm)
      }
    } else if (this.stroke.length >= 2) {
      const pts: Array<{ x: number; y: number }> = []
      for (const p of this.stroke) {
        const screen = this.clientOfWorld(p)
        if (!screen) continue
        pts.push({ x: screen.x - canvasRect.left, y: screen.y - canvasRect.top })
      }
      if (pts.length >= 2) {
        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        ctx.beginPath()
        ctx.moveTo(pts[0]!.x, pts[0]!.y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
        ctx.strokeStyle = "#0b1220"
        ctx.lineWidth = 8
        ctx.globalAlpha = 0.85
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(pts[0]!.x, pts[0]!.y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
        ctx.strokeStyle = "#22d3ee"
        ctx.lineWidth = 3.5
        ctx.globalAlpha = 1
        ctx.stroke()

        const s = pts[0]!
        ctx.beginPath()
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2)
        ctx.fillStyle = "#0b1220"
        ctx.globalAlpha = 0.9
        ctx.fill()
        ctx.beginPath()
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = "#22d3ee"
        ctx.globalAlpha = 1
        ctx.fill()
      }
    }

    // Committed rect sizes stay on-canvas (snap-style), including after typed W/H.
    if (!(this.regionTool === "rect" && this.rectCorner0)) {
      for (const region of this.regions) {
        if (region.kind !== "rect" || !region.size || !region.plane) continue
        this.paintRectSizeLabels(
          ctx,
          canvasRect,
          { ...region.plane, normal: region.normal },
          region.plane.boundary2d,
          region.size.width_mm,
          region.size.height_mm,
          region.size.quality === "construction" ? "#fbbf24" : "#22d3ee",
        )
      }
    }
  }

  private handlePointerCancel = (event: PointerEvent) => {
    if (this.pickGesture?.pointerId === event.pointerId) this.cancelPickGesture()
    if (this.drawPointerId === event.pointerId || this.drawing) {
      this.cancelRegionStroke(true)
    }
    if (this.pointerDown?.id === event.pointerId) this.pointerDown = null
    if (!event.isPrimary) this.multiTouchActive = false
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (!event.isPrimary) {
      this.multiTouchActive = false
      return
    }

    if (this.pickGesture && event.pointerId === this.pickGesture.pointerId) {
      const gesture = this.pickGesture
      try {
        this.renderer.domElement.releasePointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      this.pointerDown = null
      if (this.multiTouchActive) {
        this.multiTouchActive = false
        this.cancelPickGesture()
        return
      }
      if (gesture.armed && !gesture.cancelled) {
        this.pickAt(event.clientX, event.clientY, gesture.pointerType)
        this.endPickGesture()
        return
      }
      const armed = gesture.armed
      const cancelled = gesture.cancelled
      this.endPickGesture()
      if (armed || cancelled) return
      // Quick tap (hold never armed): place with snap at lift point if little movement.
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      if (dx * dx + dy * dy <= TAP_MOVE_PX * TAP_MOVE_PX) {
        this.pickAt(event.clientX, event.clientY, gesture.pointerType)
      }
      return
    }

    if (this.drawing && event.pointerId === this.drawPointerId) {
      try {
        this.renderer.domElement.releasePointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      this.pointerDown = null

      if (this.multiTouchActive) {
        this.multiTouchActive = false
        this.cancelRegionStroke(true)
        return
      }

      if (this.regionTool === "rect") {
        this.snapPreview = null
        this.endDrawGesture()
        this.applyControlsForMode()
        if (!this.tryCommitRect()) this.cancelRegionStroke(true)
        return
      }

      const closed = this.canCloseStroke(event.clientX, event.clientY)
      this.endDrawGesture()
      this.applyControlsForMode()

      // Closed → commit (discard on reject). Open → discard.
      if (closed) {
        if (!this.tryCommitRegion()) this.cancelRegionStroke(true)
      } else {
        this.cancelRegionStroke(true)
      }
      return
    }

    const start = this.pointerDown
    this.pointerDown = null
    if (this.multiTouchActive) {
      this.multiTouchActive = false
      return
    }
    if (!start || start.id !== event.pointerId) return
    if (this.parts.length === 0) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (dx * dx + dy * dy > TAP_MOVE_PX * TAP_MOVE_PX) return

    if (this.interactionMode === "region" && this.regionTool === "face") {
      this.tryCommitFaceAt(event.clientX, event.clientY)
      return
    }

    // Region freehand: empty tap cancels face lock with no stroke
    if (
      this.interactionMode === "region" &&
      this.regionTool === "freehand" &&
      this.regionLock &&
      this.stroke.length < 2
    ) {
      const hit = this.hitAt(event.clientX, event.clientY)
      if (!hit) this.cancelRegionStroke(true)
    }
  }

  /** Whole-face region from mesh boundary edges (tap). */
  private tryCommitFaceAt(clientX: number, clientY: number): boolean {
    const hit = this.hitAt(clientX, clientY)
    if (!hit) return false
    if (hit.faceId === null) {
      this.onMessage?.("Region needs face-split mesh (built design)")
      return false
    }
    if (this.regions.length >= MAX_REGIONS) {
      this.onMessage?.(`Max ${MAX_REGIONS} regions`)
      return false
    }
    if (this.regions.some((r) => r.partIndex === hit.partIndex && r.faceId === hit.faceId && r.kind === "face")) {
      this.onMessage?.("Face already selected")
      return false
    }
    const index = this.getFaceSnapIndex(hit.partIndex, hit.faceId)
    let ring = orderBoundaryRing(index.edges)
    if (ring.length < MIN_REGION_VERTS) {
      this.onMessage?.("Could not outline face")
      return false
    }
    ring = simplify3d(ring, MAX_REGION_VERTS)
    if (ring.length < MIN_REGION_VERTS) {
      this.onMessage?.("Could not outline face")
      return false
    }

    const normal = roundVec3({ x: hit.normal.x, y: hit.normal.y, z: hit.normal.z })
    const isPlane = hit.faceType === "plane" || pointsNearPlane(ring, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, normal)
    let boundary: Vec3[]
    let plane: RegionInfo["plane"]
    let approximation: RegionInfo["approximation"]

    if (isPlane) {
      const frame = buildPlaneFrame({ x: hit.point.x, y: hit.point.y, z: hit.point.z }, normal)
      if (!frame) {
        this.onMessage?.("Could not outline face")
        return false
      }
      let ring2d = ring.map((p) => toPlane2d(p, frame))
      ring2d = ensureCcw2d(ring2d)
      boundary = ring2d.map((p) => roundVec3(fromPlane2d(p, frame)))
      plane = {
        origin: roundVec3(frame.origin),
        xAxis: roundVec3(frame.xAxis),
        yAxis: roundVec3(frame.yAxis),
        boundary2d: ring2d.map(roundVec2),
      }
      approximation = "plane-projected"
    } else {
      boundary = ring.map(roundVec3)
      plane = undefined
      approximation = "mesh-samples"
    }

    const region: RegionInfo = {
      id: `r${++this.regionIdSeq}`,
      part: hit.part.name,
      partIndex: hit.partIndex,
      faceId: hit.faceId,
      faceType: hit.faceType ?? (isPlane ? "plane" : null),
      boundary,
      normal,
      centroid: roundVec3(index.center ?? centroid3(boundary)),
      approximation,
      kind: "face",
      plane,
    }
    this.regions.push(region)
    this.snapPreview = null
    this.rebuildRegionOverlays()
    this.applySelectionColors()
    this.emitRegions()
    this.emitDraft()
    this.paintDrawOverlay()
    return true
  }

  private beginPickGesture(event: PointerEvent) {
    this.cancelPickGesture()
    // Link mode uses tap only — don't steal hold for snap-drag.
    if (this.linkArmed) {
      this.pickGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        pointerType: event.pointerType,
        armed: false,
        cancelled: false,
        holdTimer: null,
      }
      return
    }
    // Do NOT preventDefault here — OrbitControls needs pointerdown for 1-finger rotate.
    // Snap-drag only steals the gesture after a still hold (armPickDrag).
    this.pickGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      pointerType: event.pointerType,
      armed: false,
      cancelled: false,
      holdTimer: setTimeout(() => this.armPickDrag(), PICK_HOLD_MS),
    }
  }

  private armPickDrag() {
    const g = this.pickGesture
    if (!g || g.cancelled || g.armed || this.multiTouchActive) return
    const dx = g.lastX - g.startX
    const dy = g.lastY - g.startY
    if (dx * dx + dy * dy > PICK_ORBIT_SLOP_PX * PICK_ORBIT_SLOP_PX) {
      // User is orbiting — leave controls alone.
      this.cancelPickGesture()
      return
    }
    const hit = this.hitAt(g.lastX, g.lastY)
    if (!hit) {
      this.cancelPickGesture()
      return
    }
    g.armed = true
    this.controls.enabled = false
    try {
      this.renderer.domElement.setPointerCapture(g.pointerId)
    } catch {
      /* ignore */
    }
    this.updateSnapPreviewAt(g.lastX, g.lastY, g.pointerType)
    this.paintDrawOverlay()
    this.onMessage?.("Drag to snap · release to place")
  }

  private cancelPickGesture() {
    const g = this.pickGesture
    if (g?.holdTimer) clearTimeout(g.holdTimer)
    if (g?.armed) {
      try {
        this.renderer.domElement.releasePointerCapture(g.pointerId)
      } catch {
        /* ignore */
      }
      this.controls.enabled = true
    }
    this.pickGesture = null
    this.snapPreview = null
    this.paintDrawOverlay()
  }

  private endPickGesture() {
    const g = this.pickGesture
    if (g?.holdTimer) clearTimeout(g.holdTimer)
    if (g?.armed) this.controls.enabled = true
    this.pickGesture = null
    this.snapPreview = null
    this.paintDrawOverlay()
  }

  private snapThresholds(pointerType: string): { vertex: number; edge: number; center: number } {
    const touch = pointerType === "touch" || pointerType === "pen"
    const scale = touch ? TOUCH_SNAP_SCALE : 1
    return {
      vertex: VERTEX_SNAP_PX * scale,
      edge: EDGE_SNAP_PX * scale,
      center: CENTER_SNAP_PX * scale,
    }
  }

  private updateSnapPreviewAt(clientX: number, clientY: number, pointerType: string) {
    const hit = this.hitAt(clientX, clientY)
    if (!hit) {
      this.snapPreview = null
      return
    }
    const hitPos = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
    const th = this.snapThresholds(pointerType)
    const index = hit.faceId !== null ? this.getFaceSnapIndex(hit.partIndex, hit.faceId) : null
    const snapped = index
      ? resolveMeshSnap(hitPos, clientX, clientY, index, (p) => this.projectClient(p), th.vertex, th.edge, th.center)
      : { position: hitPos, snap: "free" as const, quality: "mesh-approx" as const }
    const edgeGuides = index ? nearestEdgeOffsets(snapped.position, index.edges, 2) : []
    this.snapPreview = {
      clientX,
      clientY,
      world: snapped.position,
      snap: snapped.snap,
      edgeGuides,
    }
  }

  private tryCommitRect(): boolean {
    const lock = this.regionLock
    if (!lock?.frame || !this.rectCorner0 || !this.rectCorner1) return false
    if (this.regions.length >= MAX_REGIONS) {
      this.onMessage?.(`Max ${MAX_REGIONS} regions`)
      return false
    }
    const a = toPlane2d({ x: this.rectCorner0.x, y: this.rectCorner0.y, z: this.rectCorner0.z }, lock.frame)
    const b = toPlane2d({ x: this.rectCorner1.x, y: this.rectCorner1.y, z: this.rectCorner1.z }, lock.frame)
    const rect = axisAlignedRect2d(a, b)
    if (!rectMeetsMinSize(rect.width_mm, rect.height_mm, MIN_REGION_AREA_MM2)) {
      this.onMessage?.("Region too small")
      return false
    }
    const boundary2d = rect.boundary2d.map(roundVec2)
    const boundary = boundary2d.map((p) => roundVec3(fromPlane2d(p, lock.frame!)))
    const normal = roundVec3({ x: lock.normal.x, y: lock.normal.y, z: lock.normal.z })
    const region: RegionInfo = {
      id: `r${++this.regionIdSeq}`,
      part: lock.partName,
      partIndex: lock.partIndex,
      faceId: lock.faceId,
      faceType: lock.faceType,
      boundary,
      normal,
      centroid: roundVec3(centroid3(boundary)),
      approximation: "plane-projected",
      kind: "rect",
      size: {
        width_mm: +rect.width_mm.toFixed(3),
        height_mm: +rect.height_mm.toFixed(3),
        quality: "mesh-approx",
        frame: "viewer-plane",
      },
      plane: {
        origin: roundVec3(lock.frame.origin),
        xAxis: roundVec3(lock.frame.xAxis),
        yAxis: roundVec3(lock.frame.yAxis),
        boundary2d,
      },
    }
    this.regions.push(region)
    this.rebuildRegionOverlays()
    this.regionLock = null
    this.stroke = []
    this.strokePathMm = 0
    this.strokeLeftStart = false
    this.rectCorner0 = null
    this.rectCorner1 = null
    this.clearDrawOverlay()
    this.applyControlsForMode()
    this.applySelectionColors()
    this.emitRegions()
    this.emitDraft()
    return true
  }

  private clientOfWorld(point: THREE.Vector3): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const projected = point.clone().project(this.camera)
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    }
  }

  private tryCommitRegion(): boolean {
    const lock = this.regionLock
    if (!lock || this.stroke.length < MIN_REGION_VERTS) return false
    if (this.regions.length >= MAX_REGIONS) {
      this.onMessage?.(`Max ${MAX_REGIONS} regions`)
      return false
    }

    const raw: Vec3[] = this.stroke.map((p) => ({ x: p.x, y: p.y, z: p.z }))
    let boundary: Vec3[]
    let plane: RegionInfo["plane"]
    let approximation: RegionInfo["approximation"]

    if (lock.frame && lock.faceType === "plane") {
      let ring2d = raw.map((p) => toPlane2d(p, lock.frame!))
      ring2d = simplify2d(ring2d, MAX_REGION_VERTS)
      ring2d = ensureCcw2d(ring2d)
      if (ring2d.length < MIN_REGION_VERTS) {
        this.onMessage?.("Region too simple")
        return false
      }
      const area = Math.abs(polygonArea2d(ring2d))
      if (area < MIN_REGION_AREA_MM2) {
        this.onMessage?.("Region too small")
        return false
      }
      boundary = ring2d.map((p) => roundVec3(fromPlane2d(p, lock.frame!)))
      plane = {
        origin: roundVec3(lock.frame.origin),
        xAxis: roundVec3(lock.frame.xAxis),
        yAxis: roundVec3(lock.frame.yAxis),
        boundary2d: ring2d.map(roundVec2),
      }
      approximation = "plane-projected"
    } else {
      boundary = simplify3d(raw, MAX_REGION_VERTS).map(roundVec3)
      if (boundary.length < MIN_REGION_VERTS) {
        this.onMessage?.("Region too simple")
        return false
      }
      plane = undefined
      approximation = "mesh-samples"
    }

    const normal = roundVec3({ x: lock.normal.x, y: lock.normal.y, z: lock.normal.z })
    const region: RegionInfo = {
      id: `r${++this.regionIdSeq}`,
      part: lock.partName,
      partIndex: lock.partIndex,
      faceId: lock.faceId,
      faceType: lock.faceType,
      boundary,
      normal,
      centroid: roundVec3(centroid3(boundary)),
      approximation,
      kind: "freehand",
      plane,
    }

    this.regions.push(region)
    this.rebuildRegionOverlays()
    this.regionLock = null
    this.stroke = []
    this.strokePathMm = 0
    this.strokeLeftStart = false
    this.rectCorner0 = null
    this.rectCorner1 = null
    this.clearDrawOverlay()
    this.applyControlsForMode()
    this.applySelectionColors()
    this.emitRegions()
    this.emitDraft()
    return true
  }

  private makeRegionLine(positions: number[], width: number, color: number): Line2 {
    const mat = new LineMaterial({
      color,
      linewidth: width,
      transparent: true,
      opacity: 1,
      depthTest: false,
      worldUnits: false,
    })
    const size = this.renderer.getSize(new THREE.Vector2())
    mat.resolution.set(size.x || this.container.clientWidth || 1, size.y || this.container.clientHeight || 1)
    const line = new Line2(new LineGeometry(), mat)
    ;(line.geometry as LineGeometry).setPositions(positions)
    line.computeLineDistances()
    line.frustumCulled = false
    line.raycast = () => {}
    line.renderOrder = 11
    return line
  }

  private rebuildRegionOverlays() {
    this.disposeRegionOverlays()
    for (const region of this.regions) {
      const group = new THREE.Group()
      group.name = region.id
      const n = new THREE.Vector3(region.normal.x, region.normal.y, region.normal.z).normalize()
      if (n.lengthSq() < 1e-8) n.set(0, 1, 0)

      const pts = region.boundary.map((p) => {
        const v = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(n, REGION_BIAS)
        return v
      })
      if (pts.length >= 2) {
        const closed = pts.concat(pts[0]!)
        const positions: number[] = []
        for (const p of closed) positions.push(p.x, p.y, p.z)
        group.add(this.makeRegionLine(positions, 10, REGION_INK_HALO))
        group.add(this.makeRegionLine(positions, 4, REGION_INK))
      }

      if (region.approximation === "plane-projected" && region.plane && pts.length >= 3) {
        const shape = new THREE.Shape()
        const b0 = region.plane.boundary2d[0]!
        shape.moveTo(b0.u, b0.v)
        for (let i = 1; i < region.plane.boundary2d.length; i++) {
          const b = region.plane.boundary2d[i]!
          shape.lineTo(b.u, b.v)
        }
        shape.closePath()
        const geom = new THREE.ShapeGeometry(shape)
        const mat = new THREE.MeshBasicMaterial({
          color: REGION_FILL,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
        const mesh = new THREE.Mesh(geom, mat)
        const origin = new THREE.Vector3(region.plane.origin.x, region.plane.origin.y, region.plane.origin.z).addScaledVector(
          n,
          REGION_BIAS,
        )
        const xAxis = new THREE.Vector3(region.plane.xAxis.x, region.plane.xAxis.y, region.plane.xAxis.z).normalize()
        const yAxis = new THREE.Vector3(region.plane.yAxis.x, region.plane.yAxis.y, region.plane.yAxis.z).normalize()
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize()
        const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
        basis.setPosition(origin)
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(basis)
        mesh.raycast = () => {}
        mesh.renderOrder = 8
        group.add(mesh)
      }

      group.traverse((obj) => {
        obj.raycast = () => {}
      })
      this.regionOverlay.add(group)
    }
  }

  private getFaceSnapIndex(partIndex: number, faceId: number): SnapIndex {
    const key = `${partIndex}:${faceId}`
    const cached = this.faceSnapCache.get(key)
    if (cached) return cached
    const raw: Vec3[] = []
    const triangles: Array<[number, number, number]> = []
    for (const mesh of this.faceMeshes(partIndex, faceId)) {
      mesh.updateWorldMatrix(true, false)
      const pos = mesh.geometry?.getAttribute("position")
      if (!pos) continue
      const base = raw.length
      for (let i = 0; i < pos.count; i++) {
        this.snapAttrVec.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        raw.push({ x: this.snapAttrVec.x, y: this.snapAttrVec.y, z: this.snapAttrVec.z })
      }
      const index = mesh.geometry.getIndex()
      if (index) {
        for (let i = 0; i < index.count; i += 3) {
          triangles.push([base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2)])
        }
      } else {
        for (let i = 0; i + 2 < pos.count; i += 3) {
          triangles.push([base + i, base + i + 1, base + i + 2])
        }
      }
    }
    const vertices = dedupeVertices(raw)
    const edges = boundaryEdgesFromTriangles(raw, triangles)
    const snap: SnapIndex = { vertices, edges, center: faceCentroid(vertices) }
    this.faceSnapCache.set(key, snap)
    return snap
  }

  private disposeMeasureOverlays() {
    while (this.measureOverlay.children.length > 0) {
      const child = this.measureOverlay.children[0]!
      this.measureOverlay.remove(child)
      if (child instanceof Line2) {
        child.geometry.dispose()
        ;(child.material as LineMaterial).dispose()
      }
    }
  }

  private rebuildMeasureOverlays() {
    this.disposeMeasureOverlays()
    const byId = new Map(this.picks.filter((p) => p.id).map((p) => [p.id!, p]))
    for (const pair of this.linkedPairs) {
      const a = byId.get(pair.fromId)
      const b = byId.get(pair.toId)
      if (!a || !b) continue
      const positions = [a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z]
      const line = this.makeRegionLine(positions, 2.2, 0xfbbf24)
      line.renderOrder = 12
      this.measureOverlay.add(line)
    }
  }

  private projectClient(point: Vec3): { x: number; y: number } | null {
    this.snapProjectVec.set(point.x, point.y, point.z).project(this.camera)
    if (this.snapProjectVec.z < -1 || this.snapProjectVec.z > 1) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: rect.left + (this.snapProjectVec.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-this.snapProjectVec.y * 0.5 + 0.5) * rect.height,
    }
  }

  private pickAt(clientX: number, clientY: number, pointerType = "mouse") {
    const hit = this.hitAt(clientX, clientY)
    if (!hit) return

    const hitPos = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
    const th = this.snapThresholds(pointerType)
    const snapped =
      hit.faceId !== null
        ? resolveMeshSnap(
            hitPos,
            clientX,
            clientY,
            this.getFaceSnapIndex(hit.partIndex, hit.faceId),
            (p) => this.projectClient(p),
            th.vertex,
            th.edge,
            th.center,
          )
        : { position: hitPos, snap: "free" as const, quality: "mesh-approx" as const }

    const next: ClickInfo = {
      id: `p${++this.pinIdSeq}`,
      position: {
        x: +snapped.position.x.toFixed(3),
        y: +snapped.position.y.toFixed(3),
        z: +snapped.position.z.toFixed(3),
      },
      normal: { x: +hit.normal.x.toFixed(4), y: +hit.normal.y.toFixed(4), z: +hit.normal.z.toFixed(4) },
      part: hit.part.name,
      direction: dominantDirection(hit.normal),
      partIndex: hit.partIndex,
      faceId: hit.faceId,
      faceType: hit.faceType,
      triangleIndex: hit.triangleIndex,
      snap: snapped.snap,
      quality: snapped.quality,
    }

    const existing = this.picks.findIndex((p) => picksMatch(p, next))
    if (existing >= 0) {
      const existingPick = this.picks[existing]!
      if (this.linkArmed && existingPick.id) {
        if (!this.linkFromId) {
          this.linkFromId = existingPick.id
          this.onMessage?.("Link: tap second pin")
        } else if (this.linkFromId === existingPick.id) {
          this.linkFromId = null
        } else if (this.linkedPairs.length >= MAX_LINKED_PAIRS) {
          this.onMessage?.(`Max ${MAX_LINKED_PAIRS} linked pairs`)
        } else if (undirectedPairExists(this.linkedPairs, this.linkFromId, existingPick.id)) {
          this.linkFromId = null
          this.onMessage?.("Pair already linked")
        } else {
          this.linkedPairs.push({ fromId: this.linkFromId, toId: existingPick.id })
          this.linkFromId = null
          this.rebuildMeasureOverlays()
          this.onMessage?.("Pair linked")
        }
        this.emitLinkedPairs()
        return
      }
      const removedId = existingPick.id
      this.picks.splice(existing, 1)
      if (removedId) {
        this.linkedPairs = this.linkedPairs.filter((p) => p.fromId !== removedId && p.toId !== removedId)
        if (this.linkFromId === removedId) this.linkFromId = null
      }
    } else if (this.picks.length >= MAX_PICKS) {
      const dropped = this.picks.shift()
      if (dropped?.id) {
        this.linkedPairs = this.linkedPairs.filter((p) => p.fromId !== dropped.id && p.toId !== dropped.id)
        if (this.linkFromId === dropped.id) this.linkFromId = null
      }
      this.picks.push(next)
    } else {
      this.picks.push(next)
    }

    this.syncPins()
    this.rebuildMeasureOverlays()
    this.applySelectionColors()
    this.emitPicks()
    this.emitLinkedPairs()
  }

  private animate = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    this.controls.update()
    this.updatePinScales()
    if (this.needsDrawOverlay()) this.paintDrawOverlay()
    this.renderer.render(this.scene, this.camera)
  }
}
