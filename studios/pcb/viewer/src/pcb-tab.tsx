import { PCBViewer } from "@tscircuit/pcb-viewer"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"
import { ViewerFrame } from "./viewer-frame"

export default function PcbTab({ projectId }: { projectId: string }) {
  const { data, dataUpdatedAt, isLoading, error } = useCircuitJson(projectId)
  const fallback = <SvgViewer url={api.pcbSvgUrl(projectId)} label="PCB Layout" />

  if (isLoading) {
    return (
      <div className="pcb-viewer-empty" role="status" aria-busy="true">
        <span className="sr-only">Loading PCB layout…</span>
        <div className="pcb-skeleton h-40 w-64 max-w-[85%]" aria-hidden />
        <p className="text-[12px] text-[var(--osc-text-faint)]">Loading PCB layout…</p>
      </div>
    )
  }
  if (error) return fallback

  return (
    <ViewerFrame>
      {({ height }) => (
        <ViewerErrorBoundary key={projectId} resetKey={dataUpdatedAt} fallback={fallback}>
          <PCBViewer circuitJson={data} height={Math.max(320, Math.floor(height))} />
        </ViewerErrorBoundary>
      )}
    </ViewerFrame>
  )
}
