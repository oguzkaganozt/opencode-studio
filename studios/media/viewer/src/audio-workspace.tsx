import { useEffect, useRef, useState } from "react"
import { createMediaSelection, formatSeconds, type MediaSelection } from "./selection"

export function AudioWorkspace({
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
  const audioRef = useRef<HTMLAudioElement>(null)
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)

  useEffect(() => {
    setDuration(0)
    setStart(0)
    setEnd(0)
    onSelectionChange(createMediaSelection({ modality: "audio", path }))
    return () => onSelectionChange(null)
  }, [path, onSelectionChange])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 py-6">
      <audio
        ref={audioRef}
        aria-label={`Audio preview: ${path}`}
        controls
        src={src}
        className="w-full"
        onError={onError}
        onLoadedMetadata={(event) => {
          const media = event.currentTarget
          const next = Number.isFinite(media.duration) ? media.duration : 0
          setDuration(next)
          setStart(0)
          setEnd(next)
          onSelectionChange(
            next > 0.05 ? createMediaSelection({ modality: "audio", path, temporal: { start: 0, end: next } }) : createMediaSelection({ modality: "audio", path }),
          )
        }}
      />
      {duration > 0 ? (
        <div className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3">
          <p className="mb-2 font-mono text-[11px] text-[var(--osc-text-muted)]">
            Optional trim · {formatSeconds(start)}s–{formatSeconds(end)}s
          </p>
          <label className="grid gap-1 text-[11px] text-[var(--osc-text-muted)]">
            Start
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={start}
              onChange={(event) => {
                const nextStart = Math.min(Number(event.target.value), Math.max(0, end - 0.05))
                setStart(nextStart)
                onSelectionChange(createMediaSelection({ modality: "audio", path, temporal: { start: nextStart, end } }))
              }}
            />
          </label>
          <label className="mt-2 grid gap-1 text-[11px] text-[var(--osc-text-muted)]">
            End
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={end}
              onChange={(event) => {
                const nextEnd = Math.max(Number(event.target.value), start + 0.05)
                setEnd(nextEnd)
                onSelectionChange(createMediaSelection({ modality: "audio", path, temporal: { start, end: nextEnd } }))
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}
