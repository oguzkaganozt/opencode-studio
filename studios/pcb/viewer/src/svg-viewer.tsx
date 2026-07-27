import { useState } from "react"

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ")
}

export function SvgViewer({ url, label }: { url: string; label: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  return (
    <div className="relative flex h-full min-h-[min(560px,50dvh)] w-full flex-1 items-center justify-center overflow-auto rounded-md bg-[var(--osc-canvas-bg-light)]">
      {!loaded && !error && (
        <div className="flex items-center justify-center py-24 text-sm text-[var(--osc-text-muted)]">Loading {label}…</div>
      )}
      {error && (
        <div className="flex items-center justify-center py-24 text-sm text-[var(--osc-error)]">
          {label} not available. Run pcb_circuit_export first.
        </div>
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
