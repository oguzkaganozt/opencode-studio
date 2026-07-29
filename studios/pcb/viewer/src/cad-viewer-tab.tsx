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
  const [manifoldAttempt, setManifoldAttempt] = useState(0)
  const { data, dataUpdatedAt, isLoading, error, refetch } = useCircuitJson(projectId)
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
  }, [manifoldAttempt])

  if (manifoldError) {
    return (
      <ErrorState
        className="m-4 border-0 py-16"
        title="Failed to load 3D engine"
        description={manifoldError}
        action={
          <button
            type="button"
            className="pcb-chip"
            onClick={() => {
              setManifoldError(null)
              setManifoldReady(false)
              setManifoldAttempt((attempt) => attempt + 1)
            }}
          >
            Retry 3D engine
          </button>
        }
      />
    )
  }
  if (!manifoldReady || isLoading) {
    return (
      <div className="pcb-viewer-empty" role="status" aria-busy="true">
        <div className="pcb-skeleton h-48 w-72 max-w-[80%]" aria-hidden />
        <p className="text-[12px] text-[var(--osc-text-faint)]">Preparing 3D engine and models…</p>
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
  const fallback = (
    <ErrorState
      className="m-4 border-0 py-16"
      title="3D viewer could not render this circuit"
      description="Retry after the circuit or model assets have been updated."
      action={
        <button type="button" className="pcb-chip" onClick={() => void refetch()}>
          Retry 3D view
        </button>
      }
    />
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="pcb-asset-bar" role="status" aria-live="polite">
        <span className="pcb-asset-bar__label">Model coverage</span>
        {isCheckingAssets && <span className="text-[var(--osc-text-muted)]">Checking model availability…</span>}
        {assetHealth?.status === "complete" && assetHealth.total === 0 && (
          <span className="text-[var(--osc-text-muted)]">No external component models required</span>
        )}
        {assetHealth?.status === "complete" && assetHealth.total > 0 && (
          <span className="text-[var(--osc-success)]">
            {assetHealth.available} of {assetHealth.total} model files available
          </span>
        )}
        {assetHealth?.status === "partial" && (
          <details className="pcb-asset-details">
            <summary className="pcb-asset-summary">
              <span>
                {assetHealth.available} of {assetHealth.total} model files available
              </span>
              <span className="pcb-asset-count">{assetHealth.missing} unavailable</span>
            </summary>
            <div className="pcb-asset-issues">
              <p>The board remains interactive without these models.</p>
              <ul>
                {assetHealth.issues.map((issue, index) => (
                  <li key={`${issue.component}-${index}`} title={issue.url}>
                    <code>{issue.component}</code>
                    <span>{issue.reason === "no-model" ? "No CAD model defined" : "Model URL unavailable"}</span>
                  </li>
                ))}
              </ul>
            </div>
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
