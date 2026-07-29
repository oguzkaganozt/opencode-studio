import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import type {
  ClickInfo,
  InteractionMode,
  LoadPart,
  PartTopo,
  RegionDraft,
  RegionInfo,
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
import { dominantDirection } from "./geometry"
import {
  buildPlaneFrame,
  centroid3,
  ensureCcw2d,
  fromPlane2d,
  nearStartScreen,
  polygonArea2d,
  roundVec2,
  roundVec3,
  simplify2d,
  simplify3d,
  toPlane2d,
  type PlaneFrame,
} from "./region-geometry"

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
  private picks: ClickInfo[] = []
  private pins: THREE.Group[] = []
  private readonly pinUp = new THREE.Vector3(0, 1, 0)
  private readonly pinNormal = new THREE.Vector3()
  private readonly pinQuat = new THREE.Quaternion()
  private interactionMode: InteractionMode = "pick"
  private regions: RegionInfo[] = []
  private regionLock: RegionLock | null = null
  private stroke: THREE.Vector3[] = []
  private strokePathMm = 0
  /** Must leave the start snap zone before re-entry can close (avoids instant auto-close). */
  private strokeLeftStart = false
  private drawing = false
  private drawPointerId: number | null = null
  private strokeStartClient: { x: number; y: number } | null = null
  /** Screen-space live stroke (always visible while drawing; WebGL fat lines are unreliable mid-gesture). */
  private readonly drawCanvas: HTMLCanvasElement
  private readonly drawCtx: CanvasRenderingContext2D
  private readonly regionOverlay = new THREE.Group()
  private regionIdSeq = 0

  onPicksChange: ((picks: ClickInfo[]) => void) | null = null
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

    canvas.addEventListener("pointerdown", this.handlePointerDown, true)
    canvas.addEventListener("pointermove", this.handlePointerMove, true)
    canvas.addEventListener("pointerup", this.handlePointerUp, true)
    canvas.addEventListener("pointercancel", this.handlePointerCancel, true)
    this.resize()
    this.animate()
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
    this.clear()
    this.disposePins()
    this.disposeRegionOverlays()
    this.drawCanvas.remove()
    this.controls.dispose()
    this.renderer.dispose()
    canvas.remove()
  }

  clear() {
    this.loadGeneration += 1
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

  setInteractionMode = (mode: InteractionMode) => {
    if (this.interactionMode === mode) return
    this.cancelRegionStroke(true)
    this.interactionMode = mode
    this.applyControlsForMode()
    this.emitDraft()
  }

  clearPicks = (emit = true) => {
    this.picks = []
    this.syncPins()
    this.applySelectionColors()
    if (emit) this.onPicksChange?.([])
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

  cancelRegionStroke = (emit = true) => {
    this.endDrawGesture()
    this.regionLock = null
    this.stroke = []
    this.strokePathMm = 0
    this.strokeLeftStart = false
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

  private emitRegions() {
    this.onRegionsChange?.(this.regions.slice())
  }

  private emitDraft() {
    if (this.interactionMode !== "region") {
      this.onRegionDraftChange?.(null)
      return
    }
    if (!this.regionLock && this.stroke.length === 0) {
      this.onRegionDraftChange?.(null)
      return
    }
    this.onRegionDraftChange?.({
      active: this.drawing || this.stroke.length > 0 || this.regionLock !== null,
      pointCount: this.stroke.length,
      part: this.regionLock?.partName ?? null,
      faceId: this.regionLock?.faceId ?? null,
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
      // Second finger while drawing: full cancel — half endDrawGesture left lock+stroke stuck.
      if (this.drawing || (this.regionLock && this.stroke.length > 0)) {
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

    if (this.interactionMode !== "region" || this.parts.length === 0) return

    // One continuous gesture only — incomplete strokes are discarded on lift.
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

  private lockFace(hit: MeshHit) {
    const meshes = this.faceMeshes(hit.partIndex, hit.faceId!)
    const frame =
      hit.faceType === "plane" ? buildPlaneFrame({ x: hit.point.x, y: hit.point.y, z: hit.point.z }, { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }) : null
    this.regionLock = {
      partIndex: hit.partIndex,
      partName: hit.part.name,
      faceId: hit.faceId!,
      faceType: hit.faceType,
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
    if (!this.drawing || event.pointerId !== this.drawPointerId || !this.regionLock) return
    if (this.multiTouchActive) return
    const hit = this.hitAt(event.clientX, event.clientY, {
      partIndex: this.regionLock.partIndex,
      faceId: this.regionLock.faceId,
    })
    if (!hit) return
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

  /** Project live stroke to screen pixels — independent of WebGL line quirks. */
  private paintDrawOverlay() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.drawCtx.clearRect(0, 0, w, h)
    if (this.stroke.length < 2) return

    const rect = this.renderer.domElement.getBoundingClientRect()
    const pts: Array<{ x: number; y: number }> = []
    for (const p of this.stroke) {
      const screen = this.clientOfWorld(p)
      if (!screen) continue
      pts.push({ x: screen.x - rect.left, y: screen.y - rect.top })
    }
    if (pts.length < 2) return

    const ctx = this.drawCtx
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

    // Start marker — target to close against
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

  private handlePointerCancel = (event: PointerEvent) => {
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

    if (this.interactionMode === "pick") {
      this.pickAt(event.clientX, event.clientY)
      return
    }

    // Region: empty tap cancels face lock with no stroke
    if (this.regionLock && this.stroke.length < 2) {
      const hit = this.hitAt(event.clientX, event.clientY)
      if (!hit) this.cancelRegionStroke(true)
    }
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
      plane,
    }

    this.regions.push(region)
    this.rebuildRegionOverlays()
    this.regionLock = null
    this.stroke = []
    this.strokePathMm = 0
    this.strokeLeftStart = false
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

  private pickAt(clientX: number, clientY: number) {
    const hit = this.hitAt(clientX, clientY)
    if (!hit) return

    const next: ClickInfo = {
      position: { x: +hit.point.x.toFixed(3), y: +hit.point.y.toFixed(3), z: +hit.point.z.toFixed(3) },
      normal: { x: +hit.normal.x.toFixed(4), y: +hit.normal.y.toFixed(4), z: +hit.normal.z.toFixed(4) },
      part: hit.part.name,
      direction: dominantDirection(hit.normal),
      partIndex: hit.partIndex,
      faceId: hit.faceId,
      faceType: hit.faceType,
      triangleIndex: hit.triangleIndex,
    }

    const existing = this.picks.findIndex((p) => picksMatch(p, next))
    if (existing >= 0) {
      this.picks.splice(existing, 1)
    } else if (this.picks.length >= MAX_PICKS) {
      this.picks.shift()
      this.picks.push(next)
    } else {
      this.picks.push(next)
    }

    this.syncPins()
    this.applySelectionColors()
    this.emitPicks()
  }

  private animate = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    this.controls.update()
    this.updatePinScales()
    this.renderer.render(this.scene, this.camera)
  }
}
