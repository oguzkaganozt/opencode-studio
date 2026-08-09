import { SchematicViewer } from "@tscircuit/schematic-viewer"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { useEffect, useMemo, useRef, useState } from "react"
import { AgentSelectionBar } from "./agent-selection-bar"
import {
  createPcbSelectionHandoff,
  createPcbSelectionIndex,
  type PcbAgentSelection,
  pickNetFromSchematicPort,
  pickSchematicComponent,
} from "./agent-selection"
import { api } from "./api"
import { ViewerErrorBoundary } from "./error-boundary"
import { SvgViewer } from "./svg-viewer"
import { useCircuitJson } from "./use-circuit-json"
import { ViewerFrame } from "./viewer-frame"

export default function SchematicTab({ projectId, directory }: { projectId: string; directory: string }) {
  const { data, dataUpdatedAt, isLoading, error, refetch } = useCircuitJson(projectId)
  const [selection, setSelection] = useState<PcbAgentSelection | null>(null)
  const portEvents = useRef(new WeakSet<MouseEvent>())
  const index = useMemo(() => createPcbSelectionIndex(data), [data])
  useEffect(() => setSelection(null), [projectId, dataUpdatedAt])
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
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentSelectionBar
        selection={selection}
        emptyText="Click a component or visible port"
        onClear={() => setSelection(null)}
        onSend={() => selection && requestAgentHandoff(createPcbSelectionHandoff(projectId, directory, selection))}
      />
      <ViewerFrame label="Interactive schematic" className="bg-[var(--osc-canvas-bg-light)]">
        <ViewerErrorBoundary key={projectId} resetKey={dataUpdatedAt} fallback={fallback}>
          <SchematicViewer
            circuitJson={data}
            containerStyle={{ height: "100%", width: "100%" }}
            showSchematicPorts
            onSchematicPortClicked={({ schematicPortId, event }) => {
              portEvents.current.add(event)
              setSelection(pickNetFromSchematicPort(index, schematicPortId))
            }}
            onSchematicComponentClicked={({ schematicComponentId, event }) => {
              queueMicrotask(() => {
                if (!portEvents.current.has(event)) setSelection(pickSchematicComponent(index, schematicComponentId))
              })
            }}
          />
        </ViewerErrorBoundary>
      </ViewerFrame>
    </div>
  )
}
