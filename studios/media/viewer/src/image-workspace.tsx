import { useEffect, useMemo, useRef, useState } from "react"
import { Layer, Line, Rect, Stage, Image as KonvaImage } from "react-konva"
import type Konva from "konva"
import { createMediaSelection, type MediaBBox, type MediaSelection } from "./selection"

type Mode = "bbox" | "brush"

function useHtmlImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    setImage(null)
    setError(false)
    const img = new window.Image()
    img.decoding = "async"
    img.onload = () => setImage(img)
    img.onerror = () => setError(true)
    img.src = src
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])
  return { image, error }
}

function clampBBox(box: MediaBBox, maxW: number, maxH: number): MediaBBox | null {
  const x = Math.max(0, Math.min(box.x, maxW - 1))
  const y = Math.max(0, Math.min(box.y, maxH - 1))
  const w = Math.max(1, Math.min(box.w, maxW - x))
  const h = Math.max(1, Math.min(box.h, maxH - y))
  if (w < 1 || h < 1) return null
  return { x, y, w, h }
}

function strokeBounds(points: number[][]): MediaBBox | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const stroke of points) {
    for (let i = 0; i < stroke.length; i += 2) {
      const x = stroke[i]!
      const y = stroke[i + 1]!
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

export function ImageWorkspace({
  path,
  src,
  onSelectionChange,
  onError,
}: {
  path: string
  src: string
  onSelectionChange: (selection: MediaSelection | null) => void
  onError: () => void
}) {
  const { image, error } = useHtmlImage(src)
  const containerRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>("bbox")
  const [stageSize, setStageSize] = useState({ width: 320, height: 240 })
  const [draft, setDraft] = useState<MediaBBox | null>(null)
  const [strokes, setStrokes] = useState<number[][]>([])
  const strokesRef = useRef<number[][]>([])
  const drawing = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (error) onError()
  }, [error, onError])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setStageSize({ width: Math.max(160, Math.floor(rect.width)), height: Math.max(160, Math.floor(rect.height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const natural = useMemo(() => {
    if (!image) return { w: 1, h: 1 }
    return { w: image.naturalWidth || image.width || 1, h: image.naturalHeight || image.height || 1 }
  }, [image])

  const scale = useMemo(() => {
    const sx = stageSize.width / natural.w
    const sy = stageSize.height / natural.h
    return Math.min(sx, sy, 1)
  }, [natural.h, natural.w, stageSize.height, stageSize.width])

  const display = { w: Math.max(1, Math.floor(natural.w * scale)), h: Math.max(1, Math.floor(natural.h * scale)) }
  const offset = {
    x: Math.floor((stageSize.width - display.w) / 2),
    y: Math.floor((stageSize.height - display.h) / 2),
  }

  const toImage = (pos: { x: number; y: number }) => ({
    x: (pos.x - offset.x) / scale,
    y: (pos.y - offset.y) / scale,
  })

  const publish = (box: MediaBBox | null) => {
    if (!box) {
      onSelectionChange(null)
      return
    }
    const clamped = clampBBox(box, natural.w, natural.h)
    onSelectionChange(clamped ? createMediaSelection({ modality: "image", path, spatial: clamped }) : null)
  }

  useEffect(() => {
    setDraft(null)
    setStrokes([])
    strokesRef.current = []
    onSelectionChange(null)
    return () => onSelectionChange(null)
  }, [path, onSelectionChange])

  const onPointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos || !image) return
    const local = toImage(pos)
    if (local.x < 0 || local.y < 0 || local.x > natural.w || local.y > natural.h) return
    drawing.current = true
    if (mode === "bbox") {
      origin.current = local
      setDraft({ x: local.x, y: local.y, w: 1, h: 1 })
    } else {
      strokesRef.current = [...strokesRef.current, [local.x, local.y]]
      setStrokes(strokesRef.current)
    }
  }

  const onPointerMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!drawing.current) return
    const stage = event.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    const local = toImage(pos)
    if (mode === "bbox" && origin.current) {
      const x = Math.min(origin.current.x, local.x)
      const y = Math.min(origin.current.y, local.y)
      const w = Math.abs(local.x - origin.current.x)
      const h = Math.abs(local.y - origin.current.y)
      const next = { x, y, w, h }
      setDraft(next)
      publish(next)
      return
    }
    setStrokes((prev) => {
      if (!prev.length) return prev
      const copy = prev.slice()
      const last = copy[copy.length - 1]!.slice()
      last.push(local.x, local.y)
      copy[copy.length - 1] = last
      strokesRef.current = copy
      return copy
    })
  }

  const onPointerUp = () => {
    if (!drawing.current) return
    drawing.current = false
    origin.current = null
    if (mode === "brush") {
      publish(strokeBounds(strokesRef.current))
    }
  }

  if (error) return null
  if (!image) {
    return <div className="osc-skeleton mx-auto h-48 w-full max-w-xl" role="status" aria-label="Loading image" />
  }

  const viewBox = draft
    ? {
        x: offset.x + draft.x * scale,
        y: offset.y + draft.y * scale,
        w: draft.w * scale,
        h: draft.h * scale,
      }
    : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="osc-segmented" role="group" aria-label="Image selection mode">
          <button type="button" aria-selected={mode === "bbox"} onClick={() => setMode("bbox")}>
            BBox
          </button>
          <button type="button" aria-selected={mode === "brush"} onClick={() => setMode("brush")}>
            Brush
          </button>
        </div>
        <button
          type="button"
          className="osc-chip h-8 px-2.5 text-[11px]"
        onClick={() => {
          setDraft(null)
          setStrokes([])
          strokesRef.current = []
          onSelectionChange(null)
        }}
        >
          Clear region
        </button>
        <span className="font-mono text-[11px] text-[var(--osc-text-muted)]">
          {natural.w}×{natural.h}px · drag to select
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg-subtle)]">
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ cursor: "crosshair", touchAction: "none" }}
        >
          <Layer>
            <KonvaImage image={image} x={offset.x} y={offset.y} width={display.w} height={display.h} listening={false} />
            {strokes.map((points, index) => (
              <Line
                key={index}
                points={points.map((value, i) => (i % 2 === 0 ? offset.x + value * scale : offset.y + value * scale))}
                stroke="#e11d48"
                strokeWidth={Math.max(2, 14 * scale)}
                tension={0.3}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation="source-over"
                opacity={0.4}
                listening={false}
              />
            ))}
            {viewBox ? (
              <Rect
                x={viewBox.x}
                y={viewBox.y}
                width={viewBox.w}
                height={viewBox.h}
                stroke="#e11d48"
                strokeWidth={1.5}
                dash={[4, 3]}
                fill="rgba(225, 29, 72, 0.12)"
                listening={false}
              />
            ) : null}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}
