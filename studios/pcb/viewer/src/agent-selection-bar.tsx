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
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-3 py-2 text-[12px]">
      <span className="font-medium text-[var(--osc-text)]">Selection</span>
      <span className="min-w-0 flex-1 truncate text-[var(--osc-text-muted)]" role="status" aria-live="polite">
        {selection?.summary || emptyText}
      </span>
      {selection ? (
        <>
          <button type="button" className="pcb-chip" onClick={onClear}>
            Clear
          </button>
          <button type="button" className="pcb-chip pcb-chip--primary" onClick={onSend}>
            Send selection
          </button>
        </>
      ) : null}
    </div>
  )
}
