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
      <div className="flex h-full min-h-[min(560px,50dvh)] items-center justify-center text-sm text-[var(--osc-text-muted)]">Loading PCB layout…</div>
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
