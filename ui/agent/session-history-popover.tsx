import type { StudioSessionHistoryItem } from "../../src/core/session-history"
import { IconFolder } from "./icons"
import { sessionLabel } from "./session-label"

export function SessionHistoryPopover({
  sessionGroups,
  optionLabels,
  sessionID,
  sessionQuery,
  onQueryChange,
  historyScope,
  onSelect,
}: {
  sessionGroups: Array<{ key: string; label: string; sessions: StudioSessionHistoryItem[] }>
  optionLabels: Map<string, string>
  sessionID?: string
  sessionQuery: string
  onQueryChange: (value: string) => void
  historyScope: "directory" | "studio"
  onSelect: (session: StudioSessionHistoryItem) => void
}) {
  const empty = sessionGroups.every((group) => group.sessions.length === 0)
  return (
    <div className="oc-popover oc-popover--session" data-oc-popover role="listbox" aria-label="Sessions">
      <input
        className="oc-popover__search"
        placeholder="Search sessions…"
        value={sessionQuery}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <div className="oc-popover__list">
        {sessionGroups.map((group) => (
          <fieldset key={group.key} className="oc-popover__group">
            <legend className="oc-popover__group-label">{group.label}</legend>
            {group.sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === sessionID}
                className={`oc-popover__item ${s.id === sessionID ? "is-active" : ""}`}
                onClick={() => onSelect(s)}
              >
                <span className="truncate">{optionLabels.get(s.id) ?? sessionLabel(s)}</span>
                {historyScope === "studio" ? (
                  <span className="oc-popover__meta">
                    <span className="oc-popover__meta-icon" aria-hidden>
                      <IconFolder />
                    </span>
                    <span className="oc-popover__meta-text">
                      {s.context.label}
                      {s.context.relativePath && s.context.relativePath !== s.context.projectId ? ` · ${s.context.relativePath}` : ""}
                      {s.context.status === "missing" ? " · unavailable" : s.context.status === "moved" ? " · moved" : ""}
                    </span>
                  </span>
                ) : null}
              </button>
            ))}
          </fieldset>
        ))}
        {empty ? <p className="oc-popover__empty">No sessions</p> : null}
      </div>
    </div>
  )
}
