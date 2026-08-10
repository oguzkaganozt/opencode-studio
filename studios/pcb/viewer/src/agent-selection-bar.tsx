import type { PcbAgentSelection } from "./agent-selection"

export function AgentSelectionBar({
  selection,
  emptyText,
  onClear,
  onSend,
}: {
  selection: PcbAgentSelection | null
  emptyText: string
  onClear: () => void
  onSend: () => void
}) {
  return (
    <div
      className={`pcb-selection-bar${selection ? " pcb-selection-bar--active" : ""}`}
      data-has-selection={selection ? "true" : undefined}
    >
      <span className="pcb-selection-bar__label">Selection</span>
      <span className="pcb-selection-bar__value" role="status" aria-live="polite">
        {selection?.summary || emptyText}
      </span>
      {selection ? (
        <div className="pcb-selection-bar__actions">
          <button type="button" className="pcb-chip" onClick={onClear}>
            Clear
          </button>
          <button type="button" className="pcb-chip pcb-chip--primary" onClick={onSend}>
            Send selection
          </button>
        </div>
      ) : null}
    </div>
  )
}
