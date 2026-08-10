import type { ReactNode } from "react"
import { Link } from "react-router"
import type { AgentContext } from "../agent-context"
import { type AgentStatus, agentStatusDotLabel, agentStatusDotPulse, agentStatusDotTone } from "../agent-status"
import { IconChevron, IconClose, IconFolder, IconHome, IconPlus, IconStop } from "./icons"

function contextLine(activeContext: AgentContext): string {
  if (activeContext.status === "checking") return `${activeContext.label} · Loading…`
  if (activeContext.status === "missing") return `${activeContext.label} · Unavailable`
  if (activeContext.status === "moved") return `${activeContext.label} · Moved`
  return activeContext.label
}

export function AgentPanelHeader({
  status,
  sessionTitle,
  directory,
  activeContext,
  activeContextLink,
  fullPage,
  contextWritable,
  sessionID,
  busy,
  reconnecting = false,
  popoverSessionOpen,
  onToggleSessionPopover,
  onHome,
  onNewSession,
  onAbort,
  onClose,
  leading,
  trailing,
}: {
  status: AgentStatus
  sessionTitle: string
  directory?: string
  activeContext: AgentContext
  activeContextLink?: { href: string; label: string }
  fullPage: boolean
  contextWritable: boolean
  sessionID?: string
  busy: boolean
  reconnecting?: boolean
  popoverSessionOpen: boolean
  onToggleSessionPopover: () => void
  onHome: () => void
  onNewSession: () => void
  onAbort: () => void
  onClose: () => void
  leading?: ReactNode
  trailing?: ReactNode
}) {
  const dotLabel = agentStatusDotLabel(status, busy, reconnecting)
  const dotPulse = agentStatusDotPulse(status, busy, reconnecting)
  const dotTone = agentStatusDotTone(status, busy, reconnecting)

  return (
    <header className={`oc-panel__header${fullPage ? " oc-panel__header--page" : ""}`}>
      {leading}
      <span
        className={`oc-panel__dot${dotPulse ? " oc-panel__dot--pulse" : ""}`}
        data-tone={dotTone}
        title={dotLabel}
        role="img"
        aria-label={dotLabel}
      />
      <div className="oc-panel__title-wrap">
        <div className="oc-panel__session-row">
          <button
            type="button"
            data-oc-popover-trigger
            className="oc-panel__session-btn"
            onClick={onToggleSessionPopover}
            aria-expanded={popoverSessionOpen}
            title={sessionTitle}
          >
            <span className="oc-panel__session-title">{sessionTitle}</span>
            <IconChevron />
          </button>
          <button
            type="button"
            className="oc-icon-btn oc-panel__session-new"
            onClick={onNewSession}
            aria-label="New session"
            title="New session"
            disabled={!contextWritable}
          >
            <IconPlus />
          </button>
        </div>
        <p className="oc-panel__sub" title={directory}>
          <span className="oc-panel__sub-icon" aria-hidden>
            <IconFolder />
          </span>
          <span className="oc-panel__sub-text">{contextLine(activeContext)}</span>
        </p>
      </div>
      {fullPage && activeContextLink ? (
        <Link className="oc-context-link" to={activeContextLink.href}>
          {activeContextLink.label}
        </Link>
      ) : null}
      {fullPage && activeContext.key !== "home" ? (
        <button type="button" className="oc-icon-btn" onClick={onHome} aria-label="Return Home" title="Return Home">
          <IconHome />
        </button>
      ) : null}
      {sessionID && busy ? (
        <button type="button" className="oc-icon-btn oc-icon-btn--warn" onClick={onAbort} aria-label="Stop" title="Stop">
          <IconStop />
        </button>
      ) : null}
      {trailing}
      {!fullPage ? (
        <button type="button" data-autofocus className="oc-icon-btn" onClick={onClose} aria-label="Close agent" title="Close">
          <IconClose />
        </button>
      ) : null}
    </header>
  )
}
