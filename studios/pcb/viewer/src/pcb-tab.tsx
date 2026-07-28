import { PCBViewer } from "@tscircuit/pcb-viewer"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"
import { ViewerFrame } from "./viewer-frame"

export default function PcbTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useCircuitJson(projectId)
  const fallback = <SvgViewer url={api.pcbSvgUrl(projectId)} label="PCB Layout" />

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[min(560px,50dvh)] flex-col items-center justify-center gap-3" role="status" aria-busy="true">
        <span className="sr-only">Loading PCB layout…</span>
        <div className="pcb-skeleton h-48 w-72 max-w-[80%]" aria-hidden />
      </div>
    )
  }
  if (error) return fallback

  return (
    <ViewerFrame>
      {({ height }) => (
        <ViewerErrorBoundary key={projectId} fallback={fallback}>
          <PCBViewer circuitJson={data} height={Math.max(320, Math.floor(height))} />
        </ViewerErrorBoundary>
      )}
    </ViewerFrame>
  )
}
