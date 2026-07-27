import { SchematicViewer } from "@tscircuit/schematic-viewer"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"
import { ViewerFrame } from "./viewer-frame"

export default function SchematicTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useCircuitJson(projectId)
  const fallback = <SvgViewer url={api.schematicSvgUrl(projectId)} label="Schematic" />

  if (isLoading) {
    return <div className="flex h-full min-h-[min(560px,50dvh)] items-center justify-center text-sm text-[var(--osc-text-muted)]">Loading schematic…</div>
  }
  if (error) return fallback

  return (
    <ViewerFrame className="bg-[var(--osc-canvas-bg-light)]">
      <ViewerErrorBoundary key={projectId} fallback={fallback}>
        <SchematicViewer circuitJson={data} containerStyle={{ height: "100%", width: "100%" }} />
      </ViewerErrorBoundary>
    </ViewerFrame>
  )
}
