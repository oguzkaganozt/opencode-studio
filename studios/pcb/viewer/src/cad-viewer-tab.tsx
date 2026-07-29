import { useQuery } from "@tanstack/react-query"
import { CadViewer } from "@tscircuit/3d-viewer"
import { useEffect, useState } from "react"
import { ErrorState } from "@ui/components/error-state"
import { checkCadAssetHealth, preferKicadStepModels } from "./cad-models"
import { ViewerErrorBoundary } from "./error-boundary"
import { useCircuitJson } from "./use-circuit-json"
import { ViewerFrame } from "./viewer-frame"

type ManifoldToplevel = {
  setup: () => void
}

declare global {
  interface Window {
    ManifoldModule?: ManifoldToplevel
  }
}

/** Load Manifold from the local manifold-3d package (no remote scripts). */
async function ensureManifold() {
  const existing = window.ManifoldModule
  if (existing && typeof existing === "object" && typeof existing.setup === "function") {
    return
  }

  const mod = await import("manifold-3d")
  const factory = (mod as any).default ?? mod
  const loaded = typeof factory === "function" ? await factory() : factory
  if (loaded && typeof loaded.setup === "function") {
    loaded.setup()
    window.ManifoldModule = loaded
  }

  if (!window.ManifoldModule || typeof window.ManifoldModule.setup !== "function") {
    throw new Error("Manifold module failed to initialize from local package")
  }
}

export default function CadViewerTab({ projectId }: { projectId: string }) {
  const [manifoldReady, setManifoldReady] = useState(false)
  const [manifoldError, setManifoldError] = useState<string | null>(null)
  const { data, dataUpdatedAt, isLoading, error } = useCircuitJson(projectId)
  const { data: assetHealth, isLoading: isCheckingAssets } = useQuery({
    queryKey: ["pcb", "cadAssetHealth", projectId, dataUpdatedAt],
    queryFn: () => checkCadAssetHealth(data),
    enabled: Array.isArray(data),
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    let cancelled = false
    ensureManifold()
      .then(() => {
        if (!cancelled) setManifoldReady(true)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setManifoldError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (manifoldError) {
    return <ErrorState className="m-4 border-0 py-16" title="Failed to load Manifold" description={manifoldError} />
  }
  if (!manifoldReady || isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16" role="status" aria-busy="true">
        <span className="sr-only">Loading 3D view…</span>
        <div className="pcb-skeleton h-48 w-72 max-w-[80%]" aria-hidden />
      </div>
    )
  }
  if (error) {
    return (
      <ErrorState
        className="m-4 border-0 py-16"
        title="circuit.json not available"
        description="Run pcb_circuit_build first, then reopen this tab."
      />
    )
  }
  const fallback = <ErrorState className="m-4 border-0 py-16" title="3D viewer could not render this circuit" />
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-1 rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-3 py-2 text-xs sm:flex-row sm:items-start sm:gap-2">
        <span className="shrink-0 font-medium text-[var(--osc-text)]">3D assets</span>
        {isCheckingAssets && <span className="text-[var(--osc-text-muted)]">Checking model availability…</span>}
        {assetHealth?.status === "complete" && (
          <span className="text-[var(--osc-success)]">
            Complete · {assetHealth.available}/{assetHealth.total} models available
          </span>
        )}
        {assetHealth?.status === "partial" && (
          <details>
            <summary className="cursor-pointer text-[var(--osc-warning)]">
              Partial · {assetHealth.available}/{assetHealth.total} models available · {assetHealth.missing} missing
            </summary>
            <ul className="mt-2 space-y-1 text-[var(--osc-text-muted)]">
              {assetHealth.issues.map((issue, index) => (
                <li key={`${issue.component}-${index}`} title={issue.url}>
                  {issue.component}: {issue.reason === "no-model" ? "no CAD model defined" : "model URL unavailable"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <ViewerFrame label="Interactive PCB 3D view" className="bg-[var(--osc-canvas-bg)]">
        <ViewerErrorBoundary key={projectId} resetKey={dataUpdatedAt} fallback={fallback}>
          <CadViewer circuitJson={preferKicadStepModels(data)} />
        </ViewerErrorBoundary>
      </ViewerFrame>
    </div>
  )
}
