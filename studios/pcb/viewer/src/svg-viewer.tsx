import { useState } from "react"
import { ErrorState } from "@ui/components/error-state"
import { cn } from "@ui/lib/cn"

export function SvgViewer({ url, label, notice, onRetry }: { url: string; label: string; notice?: string; onRetry?: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retryUrl = `${url}${url.includes("?") ? "&" : "?"}attempt=${attempt}`

  const retry = () => {
    setLoaded(false)
    setError(false)
    setAttempt((value) => value + 1)
    onRetry?.()
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-canvas-bg-light)]" role="region" aria-label={`${label} static view`}>
      {notice ? (
        <div className="pcb-viewer-notice">
          <span>{notice}</span>
          <span className="flex items-center gap-1.5">
            {onRetry ? (
              <button type="button" className="pcb-chip" onClick={retry}>
                Retry interactive
              </button>
            ) : null}
            <a href={url} target="_blank" rel="noreferrer" className="pcb-chip">
              Open SVG
            </a>
          </span>
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {!loaded && !error && (
          <div className="flex flex-col items-center gap-3 py-16" role="status" aria-busy="true">
            <span className="sr-only">Loading {label}…</span>
            <div className="pcb-skeleton h-48 w-64 max-w-[80%]" aria-hidden />
          </div>
        )}
        {error && (
          <ErrorState
            className="m-6 max-w-md border-dashed bg-[var(--osc-bg-elevated)] py-12"
            title={`${label} not available`}
            description="The exported SVG is missing or could not be loaded. Rebuild or export the project, then retry."
            action={
              <button type="button" className="pcb-chip" onClick={retry}>
                Retry
              </button>
            }
          />
        )}
        <img
          src={retryUrl}
          alt={`${label} static export`}
          className={cn("max-h-full max-w-full object-contain p-4", loaded ? "block" : "hidden")}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false)
            setError(true)
          }}
        />
      </div>
    </div>
  )
}
