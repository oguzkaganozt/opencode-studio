import { PCBViewer } from "@tscircuit/pcb-viewer"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"

// Loaded lazily — tscircuit viewer packages are heavy.
export default function PcbTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useCircuitJson(projectId)
  const fallback = <SvgViewer url={api.pcbSvgUrl(projectId)} label="PCB Layout" />

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">Loading PCB layout…</div>
  }
  if (error) return fallback
  return (
    <div className="w-full rounded-md overflow-hidden">
      <ViewerErrorBoundary key={projectId} fallback={fallback}>
        <PCBViewer circuitJson={data} height={560} />
      </ViewerErrorBoundary>
    </div>
  )
}
