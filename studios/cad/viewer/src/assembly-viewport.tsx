import { type MutableRefObject, useEffect, useRef } from "react"
import { AssemblyScene } from "./assembly-scene"
import type { ClickInfo, LoadPart, SceneHandle } from "./assembly-types"

type AssemblyViewportProps = {
  parts: LoadPart[] | null
  onClick: (info: ClickInfo | null) => void
  onLoaded: (result: { loaded: number; failed: number }) => void
  sceneRef: MutableRefObject<SceneHandle | null>
}

export function AssemblyViewport({ parts, onClick, onLoaded, sceneRef }: AssemblyViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const internalRef = useRef<AssemblyScene | null>(null)
  const onClickRef = useRef(onClick)
  const onLoadedRef = useRef(onLoaded)
  onClickRef.current = onClick
  onLoadedRef.current = onLoaded

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scene = new AssemblyScene(container)
    scene.onClick = (info) => onClickRef.current(info)
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
    const scene = internalRef.current
    if (!scene) return
    if (!parts) {
      scene.clear()
      onClickRef.current(null)
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

  return <div ref={containerRef} className="absolute inset-0" data-testid="assembly-viewport" />
}
