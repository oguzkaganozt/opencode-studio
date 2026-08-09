import { PCBViewer } from "@tscircuit/pcb-viewer"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { useEffect, useState } from "react"
import { AgentSelectionBar } from "./agent-selection-bar"
import { createPcbSelectionHandoff, type PcbAgentSelection, pickPcbRegion } from "./agent-selection"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"
import { ViewerFrame } from "./viewer-frame"

export default function PcbTab({ projectId, directory }: { projectId: string; directory: string }) {
  const { data, dataUpdatedAt, isLoading, error, refetch } = useCircuitJson(projectId)
  const [selection, setSelection] = useState<PcbAgentSelection | null>(null)
  useEffect(() => setSelection(null), [projectId, dataUpdatedAt])
  const fallback = (
    <SvgViewer
      url={api.pcbSvgUrl(projectId)}
      label="PCB layout"
      notice={error ? "Circuit data unavailable. Trying the exported PCB layout." : "Interactive viewer failed. Showing the exported PCB layout."}
      onRetry={() => void refetch()}
    />
  )

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
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentSelectionBar
        selection={selection}
        emptyText="Use the Bounds tool to draw a layout region"
        onClear={() => setSelection(null)}
        onSend={() => selection && requestAgentHandoff(createPcbSelectionHandoff(projectId, directory, selection))}
      />
      <ViewerFrame label="Interactive PCB layout">
        {({ height }) => (
          <ViewerErrorBoundary key={projectId} resetKey={dataUpdatedAt} fallback={fallback}>
            <PCBViewer
              circuitJson={data}
              height={Math.max(1, Math.floor(height))}
              allowEditing={false}
              onBoundsSelected={(bounds) => setSelection(pickPcbRegion(bounds))}
            />
          </ViewerErrorBoundary>
        )}
      </ViewerFrame>
    </div>
  )
}
