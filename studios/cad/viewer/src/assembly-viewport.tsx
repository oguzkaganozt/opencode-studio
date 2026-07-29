import { type MutableRefObject, useEffect, useRef } from "react"
import { AssemblyScene } from "./assembly-scene"
import type {
  ClickInfo,
  InteractionMode,
  LinkedPinPair,
  LoadPart,
  RegionDraft,
  RegionInfo,
  RegionTool,
  SceneHandle,
} from "./assembly-types"

type AssemblyViewportProps = {
  parts: LoadPart[] | null
  interactionMode: InteractionMode
  regionTool: RegionTool
  linkArmed: boolean
  onPicksChange: (picks: ClickInfo[]) => void
  onLinkedPairsChange: (pairs: LinkedPinPair[], meta: { armed: boolean; fromId: string | null }) => void
  onRegionsChange: (regions: RegionInfo[]) => void
  onRegionDraftChange: (draft: RegionDraft | null) => void
  onSelectedRegionChange: (id: string | null) => void
  onMessage: (message: string) => void
  onLoaded: (result: { loaded: number; failed: number }) => void
  sceneRef: MutableRefObject<SceneHandle | null>
}

export function AssemblyViewport({
  parts,
  interactionMode,
  regionTool,
  linkArmed,
  onPicksChange,
  onLinkedPairsChange,
  onRegionsChange,
  onRegionDraftChange,
  onSelectedRegionChange,
  onMessage,
  onLoaded,
  sceneRef,
}: AssemblyViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const internalRef = useRef<AssemblyScene | null>(null)
  const onPicksChangeRef = useRef(onPicksChange)
  const onLinkedPairsChangeRef = useRef(onLinkedPairsChange)
  const onRegionsChangeRef = useRef(onRegionsChange)
  const onRegionDraftChangeRef = useRef(onRegionDraftChange)
  const onSelectedRegionChangeRef = useRef(onSelectedRegionChange)
  const onMessageRef = useRef(onMessage)
  const onLoadedRef = useRef(onLoaded)
  onPicksChangeRef.current = onPicksChange
  onLinkedPairsChangeRef.current = onLinkedPairsChange
  onRegionsChangeRef.current = onRegionsChange
  onRegionDraftChangeRef.current = onRegionDraftChange
  onSelectedRegionChangeRef.current = onSelectedRegionChange
  onMessageRef.current = onMessage
  onLoadedRef.current = onLoaded

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scene = new AssemblyScene(container)
    scene.onPicksChange = (picks) => onPicksChangeRef.current(picks)
    scene.onLinkedPairsChange = (pairs, meta) => onLinkedPairsChangeRef.current(pairs, meta)
    scene.onRegionsChange = (regions) => onRegionsChangeRef.current(regions)
    scene.onRegionDraftChange = (draft) => onRegionDraftChangeRef.current(draft)
    scene.onSelectedRegionChange = (id) => onSelectedRegionChangeRef.current(id)
    scene.onMessage = (message) => onMessageRef.current(message)
    internalRef.current = scene
    sceneRef.current = scene
    const observer = new ResizeObserver(() => scene.resize())
    observer.observe(container)
    return () => {
      observer.disconnect()
      scene.dispose()
      internalRef.current = null
      sceneRef.current = null
    }
  }, [sceneRef])

  useEffect(() => {
    internalRef.current?.setInteractionMode(interactionMode)
  }, [interactionMode])

  useEffect(() => {
    internalRef.current?.setRegionTool(regionTool)
  }, [regionTool])

  useEffect(() => {
    internalRef.current?.setLinkArmed(linkArmed)
  }, [linkArmed])

  useEffect(() => {
    const scene = internalRef.current
    if (!scene) return
    scene.clearPicks()
    scene.clearRegions()
    scene.cancelRegionStroke()
    if (!parts) {
      scene.clear()
      return
    }
    let cancelled = false
    void scene.loadParts(parts).then((result) => {
      if (!cancelled) onLoadedRef.current(result)
    })
    return () => {
      cancelled = true
    }
  }, [parts])

  return (
    <div
      ref={containerRef}
      className="cad-viewport-surface absolute inset-0"
      data-testid="assembly-viewport"
    />
  )
}
