import { useState } from "react"

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ")
}

export function SvgViewer({ url, label }: { url: string; label: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  return (
    <div className="relative w-full h-full min-h-[480px] bg-white rounded-md overflow-auto flex items-center justify-center">
      {!loaded && !error && <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">Loading {label}…</div>}
      {error && (
        <div className="flex items-center justify-center py-24 text-red-400 text-sm">
          {label} not available. Run pcb_circuit_export first.
        </div>
      )}
      <img
        src={url}
        alt={label}
        className={cn("max-w-full max-h-full object-contain p-4", loaded ? "block" : "hidden")}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false)
          setError(true)
        }}
      />
    </div>
  )
}
