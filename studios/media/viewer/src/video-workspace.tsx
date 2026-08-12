import { useEffect, useRef, useState } from "react"
import { createMediaSelection, formatSeconds, type MediaSelection } from "./selection"

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function VideoWorkspace({
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)

  useEffect(() => {
    setDuration(0)
    setCurrent(0)
    setStart(0)
    setEnd(0)
    onSelectionChange(null)
    return () => onSelectionChange(null)
  }, [path, onSelectionChange])

  const publish = (nextStart: number, nextEnd: number, maxDuration: number) => {
    const s = clamp(nextStart, 0, Math.max(0, maxDuration))
    const e = clamp(nextEnd, 0, Math.max(0, maxDuration))
    if (e - s < 0.05 || maxDuration <= 0) {
      onSelectionChange(null)
      return
    }
    onSelectionChange(createMediaSelection({ modality: "video", path, temporal: { start: s, end: e } }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <video
        ref={videoRef}
        aria-label={`Video preview: ${path}`}
        controls
        src={src}
        className="mx-auto max-h-[min(55vh,520px)] w-full max-w-3xl rounded-[var(--osc-radius-md)] bg-black"
        onError={onError}
        onLoadedMetadata={(event) => {
          const media = event.currentTarget
          const nextDuration = Number.isFinite(media.duration) ? media.duration : 0
          setDuration(nextDuration)
          setStart(0)
          setEnd(nextDuration)
          setCurrent(0)
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[var(--osc-text-muted)]">
          <span>
            In {formatSeconds(start)}s · Out {formatSeconds(end)}s · Dur {formatSeconds(Math.max(0, end - start))}s
          </span>
          <span>
            Playhead {formatSeconds(current)}s / {formatSeconds(duration)}s
          </span>
        </div>
        <label className="grid gap-1 text-[11px] text-[var(--osc-text-muted)]">
          Start
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={start}
            disabled={duration <= 0}
            onChange={(event) => {
              const next = Number(event.target.value)
              const nextStart = Math.min(next, Math.max(0, end - 0.05))
              setStart(nextStart)
              publish(nextStart, end, duration)
            }}
          />
        </label>
        <label className="grid gap-1 text-[11px] text-[var(--osc-text-muted)]">
          End
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={end}
            disabled={duration <= 0}
            onChange={(event) => {
              const next = Number(event.target.value)
              const nextEnd = Math.max(next, start + 0.05)
              setEnd(nextEnd)
              publish(start, nextEnd, duration)
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="osc-chip h-8 px-2.5 text-[11px]"
            disabled={duration <= 0}
            onClick={() => {
              const media = videoRef.current
              if (!media) return
              const nextStart = media.currentTime
              const nextEnd = Math.max(end, nextStart + 0.05)
              setStart(nextStart)
              setEnd(nextEnd)
              publish(nextStart, nextEnd, duration)
            }}
          >
            Set in
          </button>
          <button
            type="button"
            className="osc-chip h-8 px-2.5 text-[11px]"
            disabled={duration <= 0}
            onClick={() => {
              const media = videoRef.current
              if (!media) return
              const nextEnd = media.currentTime
              const nextStart = Math.min(start, Math.max(0, nextEnd - 0.05))
              setStart(nextStart)
              setEnd(nextEnd)
              publish(nextStart, nextEnd, duration)
            }}
          >
            Set out
          </button>
          <button
            type="button"
            className="osc-chip h-8 px-2.5 text-[11px]"
            disabled={duration <= 0}
            onClick={() => {
              setStart(0)
              setEnd(duration)
              publish(0, duration, duration)
            }}
          >
            Full clip
          </button>
        </div>
      </div>
    </div>
  )
}
