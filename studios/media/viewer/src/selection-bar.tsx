import type { MediaSelection } from "./selection"

export function MediaSelectionBar({
  selection,
  emptyText,
  onClear,
  onSend,
}: {
  selection: MediaSelection | null
  emptyText: string
  onClear: () => void
  onSend: () => void
}) {
  return (
    <div className={`media-selection-bar${selection ? " media-selection-bar--active" : ""}`} data-has-selection={selection ? "true" : undefined}>
      <span className="media-selection-bar__label">Selection</span>
      <span className="media-selection-bar__value" role="status" aria-live="polite">
        {selection?.summary || emptyText}
      </span>
      {selection ? (
        <div className="media-selection-bar__actions">
          <button type="button" className="osc-chip h-8 px-2.5 text-[11px]" onClick={onClear}>
            Clear
          </button>
          <button type="button" className="osc-chip media-selection-bar__send h-8 px-2.5 text-[11px]" onClick={onSend}>
            Send selection
          </button>
        </div>
      ) : null}
    </div>
  )
}
