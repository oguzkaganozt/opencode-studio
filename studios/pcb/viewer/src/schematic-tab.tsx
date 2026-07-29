import { SchematicViewer } from "@tscircuit/schematic-viewer"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"
import { ViewerFrame } from "./viewer-frame"

export default function SchematicTab({ projectId }: { projectId: string }) {
  const { data, dataUpdatedAt, isLoading, error, refetch } = useCircuitJson(projectId)
  const fallback = (
    <SvgViewer
      url={api.schematicSvgUrl(projectId)}
      label="Schematic"
      notice={error ? "Circuit data unavailable. Trying the exported schematic." : "Interactive viewer failed. Showing the exported schematic."}
      onRetry={() => void refetch()}
    />
  )

  if (isLoading) {
    return (
      <div className="pcb-viewer-empty" role="status" aria-busy="true">
        <span className="sr-only">Loading schematic…</span>
        <div className="pcb-skeleton h-40 w-64 max-w-[85%]" aria-hidden />
        <p className="text-[12px] text-[var(--osc-text-faint)]">Loading schematic…</p>
      </div>
    )
  }
  if (error) return fallback

  return (
    <ViewerFrame label="Interactive schematic" className="bg-[var(--osc-canvas-bg-light)]">
      <ViewerErrorBoundary key={projectId} resetKey={dataUpdatedAt} fallback={fallback}>
        <SchematicViewer circuitJson={data} containerStyle={{ height: "100%", width: "100%" }} />
      </ViewerErrorBoundary>
    </ViewerFrame>
  )
}
