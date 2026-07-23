import { useQuery } from "@tanstack/react-query"
import { CadViewer } from "@tscircuit/3d-viewer"
import { useEffect, useState } from "react"
import { checkCadAssetHealth, preferKicadStepModels } from "./cad-models"
import { ViewerErrorBoundary } from "./error-boundary"
import { useCircuitJson } from "./use-circuit-json"

// Same pinned release @tscircuit/3d-viewer uses in its CDN fallback.
const MANIFOLD_CDN_BASE_URL = "https://cdn.jsdelivr.net/npm/manifold-3d@3.2.1"

type ManifoldToplevel = {
  setup: () => void
}

declare global {
  interface Window {
    ManifoldModule?: ManifoldToplevel
  }
}

/**
 * @tscircuit/3d-viewer injects an inline jsDelivr import that our CSP blocks, and
 * Vite-bundled manifold-3d leaves an empty board. Prefetch the CDN module the
 * viewer expects and expose it on window before mounting CadViewer.
 */
async function ensureManifold() {
  const existing = window.ManifoldModule
  if (existing && typeof existing === "object" && typeof existing.setup === "function") {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const eventName = "osc-manifold-loaded"
    const onLoaded = () => {
      window.removeEventListener(eventName, onLoaded)
      resolve()
    }
    window.addEventListener(eventName, onLoaded, { once: true })

    const script = document.createElement("script")
    script.type = "module"
    script.textContent = `
try {
  const { default: ManifoldModule } = await import("${MANIFOLD_CDN_BASE_URL}/manifold.js");
  const loaded = await ManifoldModule();
  loaded.setup();
  window.ManifoldModule = loaded;
} catch (error) {
  console.error("OSC Manifold preload failed", error);
} finally {
  window.dispatchEvent(new CustomEvent("${eventName}"));
}
`.trim()
    script.onerror = () => reject(new Error("Failed to inject Manifold loader script"))
    document.body.appendChild(script)
  })

  if (!window.ManifoldModule || typeof window.ManifoldModule.setup !== "function") {
    throw new Error("Manifold module failed to initialize")
  }
}

// Loaded lazily — @tscircuit/3d-viewer pulls in three.js and is heavy.
export default function CadViewerTab({ projectId }: { projectId: string }) {
  const [manifoldReady, setManifoldReady] = useState(false)
  const [manifoldError, setManifoldError] = useState<string | null>(null)
  const { data, dataUpdatedAt, isLoading, error } = useCircuitJson(projectId)
  const { data: assetHealth, isLoading: isCheckingAssets } = useQuery({
    queryKey: ["cadAssetHealth", projectId, dataUpdatedAt],
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
    return <div className="flex items-center justify-center py-24 text-red-400 text-sm">Failed to load Manifold: {manifoldError}</div>
  }
  if (!manifoldReady || isLoading) {
    return <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">Loading 3D view…</div>
  }
  if (error) {
    return (
      <div className="flex items-center justify-center py-24 text-red-400 text-sm">
        circuit.json not available. Run pcb_circuit_build first.
      </div>
    )
  }
  const fallback = (
    <div className="flex items-center justify-center h-full text-red-400 text-sm">3D viewer could not render this circuit.</div>
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs sm:flex-row sm:items-start sm:gap-2">
        <span className="shrink-0 font-medium text-zinc-300">3D assets</span>
        {isCheckingAssets && <span className="text-zinc-500">Checking model availability…</span>}
        {assetHealth?.status === "complete" && (
          <span className="text-emerald-400">
            Complete · {assetHealth.available}/{assetHealth.total} models available
          </span>
        )}
        {assetHealth?.status === "partial" && (
          <details>
            <summary className="cursor-pointer text-amber-400">
              Partial · {assetHealth.available}/{assetHealth.total} models available · {assetHealth.missing} missing
            </summary>
            <ul className="mt-2 space-y-1 text-zinc-400">
              {assetHealth.issues.map((issue, index) => (
                <li key={`${issue.component}-${index}`} title={issue.url}>
                  {issue.component}: {issue.reason === "no-model" ? "no CAD model defined" : "model URL unavailable"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="w-full h-[560px] bg-zinc-900 rounded-md overflow-hidden [&>div]:h-full">
        <ViewerErrorBoundary key={projectId} fallback={fallback}>
          <CadViewer circuitJson={preferKicadStepModels(data)} />
        </ViewerErrorBoundary>
      </div>
    </div>
  )
}
