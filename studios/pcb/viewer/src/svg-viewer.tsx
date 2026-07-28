import { useState } from "react"
import { EmptyState } from "@ui/components/empty-state"
import { cn } from "@ui/lib/cn"

export function SvgViewer({ url, label }: { url: string; label: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  return (
    <div className="relative flex min-h-[min(560px,50dvh)] w-full flex-1 items-center justify-center overflow-auto rounded-[var(--osc-radius-md)] bg-[var(--osc-canvas-bg-light)]">
      {!loaded && !error && (
        <div className="flex flex-col items-center gap-3 py-16" role="status" aria-busy="true">
          <span className="sr-only">Loading {label}…</span>
          <div className="pcb-skeleton h-48 w-64 max-w-[80%]" aria-hidden />
        </div>
      )}
      {error && (
        <EmptyState
          className="m-6 max-w-md border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] py-12"
          title={`${label} not available`}
          description="Run pcb_circuit_export first, then reopen this tab."
        />
      )}
      <img
        src={url}
        alt={label}
        className={cn("max-h-full max-w-full object-contain p-4", loaded ? "block" : "hidden")}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false)
          setError(true)
        }}
      />
    </div>
  )
}
