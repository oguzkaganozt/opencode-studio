import { SchematicViewer } from "@tscircuit/schematic-viewer"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"

// Loaded lazily — tscircuit viewer packages are heavy.
export default function SchematicTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useCircuitJson(projectId)
  const fallback = <SvgViewer url={api.schematicSvgUrl(projectId)} label="Schematic" />

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">Loading schematic…</div>
  }
  if (error) return fallback
  return (
    <div className="w-full h-[560px] bg-white rounded-md overflow-hidden">
      <ViewerErrorBoundary key={projectId} fallback={fallback}>
        <SchematicViewer circuitJson={data} containerStyle={{ height: "100%" }} />
      </ViewerErrorBoundary>
    </div>
  )
}
