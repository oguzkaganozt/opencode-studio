import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import type { ClickInfo, LoadPart } from "./assembly-types"
import { dominantDirection } from "./geometry"

export type { ClickInfo, LoadPart }

export type ScenePart = {
  name: string
  group: THREE.Group
  visible: boolean
  origColor: number
  meshCount: number
}

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
  onClick: ((info: ClickInfo) => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.scene.background = new THREE.Color(0x0b0d10)
    this.camera.position.set(120, 100, 160)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    this.renderer.shadowMap.enabled = true
    container.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
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

    this.renderer.domElement.addEventListener("click", this.handleClick)
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
    this.renderer.setSize(w, h)
    if (this.parts.length > 0) setTimeout(() => this.fitCamera(), 100)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.renderer.domElement.removeEventListener("click", this.handleClick)
    this.clear()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  clear() {
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

  fitCamera() {
    const box = new THREE.Box3()
    let hasGeo = false
    for (const part of this.parts) {
      if (!part.visible) continue
      part.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          box.expandByObject(child)
          hasGeo = true
        }
      })
    }
    if (!hasGeo) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const dist = maxDim * 2.2
    this.camera.position.set(center.x + dist * 0.8, center.y + dist * 0.6, center.z + dist)
    this.controls.target.copy(center)
    this.controls.update()
  }

  setPartVisible(index: number, visible: boolean) {
    const part = this.parts[index]
    if (!part) return
    part.visible = visible
    part.group.visible = visible
    if (visible) this.fitCamera()
  }

  private loadGLB(url: string, partName: string, color: number) {
    return new Promise<THREE.Group | null>((resolve) => {
      this.loader.load(
        url,
        (gltf) => {
          const group = new THREE.Group()
          group.name = partName
          gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.material = new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.6 })
              child.receiveShadow = true
              child.castShadow = true
            }
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
    const generation = ++this.loadGeneration
    this.clear()
    const groups = await Promise.all(items.map((item) => this.loadGLB(item.url, item.name, item.color)))
    if (generation !== this.loadGeneration || this.disposed) {
      for (const group of groups) {
        group?.traverse((child) => {
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
    items.forEach((item, index) => {
      const group = groups[index]
      if (!group) return
      group.visible = true
      this.scene.add(group)
      const entry: ScenePart = {
        name: item.name,
        group,
        visible: true,
        origColor: item.color,
        meshCount: 0,
      }
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) entry.meshCount += 1
      })
      this.parts.push(entry)
      loaded += 1
    })
    setTimeout(() => this.fitCamera(), 100)
    return { loaded, failed: items.length - loaded }
  }

  private handleClick = (event: MouseEvent) => {
    if (this.parts.length === 0 || !this.onClick) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes: Array<{ mesh: THREE.Mesh; part: ScenePart }> = []
    for (const part of this.parts) {
      if (!part.visible) continue
      part.group.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push({ mesh: child, part })
      })
    }
    const hits = this.raycaster.intersectObjects(meshes.map((entry) => entry.mesh))
    if (hits.length === 0) return
    const hit = hits[0]!
    const hitInfo = meshes.find((entry) => entry.mesh === hit.object)
    const point = hit.point
    const normal = hit.face!.normal.clone()
    normal.transformDirection(hit.object.matrixWorld)

    for (const part of this.parts) {
      part.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.setHex(part.origColor)
        }
      })
    }
    if (hitInfo) {
      hitInfo.part.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.setHex(0xff6644)
        }
      })
    }

    this.onClick({
      position: { x: +point.x.toFixed(2), y: +point.y.toFixed(2), z: +point.z.toFixed(2) },
      normal: { x: +normal.x.toFixed(4), y: +normal.y.toFixed(4), z: +normal.z.toFixed(4) },
      part: hitInfo ? hitInfo.part.name : "unknown",
      direction: dominantDirection(normal),
      partIndex: hitInfo ? this.parts.indexOf(hitInfo.part) : -1,
    })
  }

  private animate = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
