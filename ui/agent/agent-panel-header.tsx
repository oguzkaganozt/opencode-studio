import { Link } from "react-router"
import type { AgentContext } from "../agent-context"
import { type AgentStatus, agentStatusDotClass } from "../agent-status"
import { IconChevron, IconClose, IconHome, IconPlus, IconStop } from "./icons"

export function AgentPanelHeader({
  status,
  sessionTitle,
  directory,
  activeContext,
  statusLabel,
  activeContextLink,
  fullPage,
  contextWritable,
  sessionID,
  busy,
  popoverSessionOpen,
  onToggleSessionPopover,
  onHome,
  onNewSession,
  onAbort,
  onClose,
}: {
  status: AgentStatus
  sessionTitle: string
  directory?: string
  activeContext: AgentContext
  statusLabel: string
  activeContextLink?: { href: string; label: string }
  fullPage: boolean
  contextWritable: boolean
  sessionID?: string
  busy: boolean
  popoverSessionOpen: boolean
  onToggleSessionPopover: () => void
  onHome: () => void
  onNewSession: () => void
  onAbort: () => void
  onClose: () => void
}) {
  return (
    <header className="oc-panel__header">
      <span className={`oc-panel__dot ${agentStatusDotClass(status)}`} aria-hidden />
      <div className="oc-panel__title-wrap">
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
        <p className="oc-panel__sub" title={directory}>
          {activeContext.label} ·{" "}
          {activeContext.status === "checking"
            ? "Loading…"
            : activeContext.status === "missing"
              ? "Unavailable"
              : activeContext.status === "moved"
                ? `Moved · ${statusLabel}`
                : statusLabel}
        </p>
      </div>
      {fullPage && activeContextLink ? (
        <Link className="oc-context-link" to={activeContextLink.href}>
          {activeContextLink.label}
        </Link>
      ) : null}
      {fullPage && activeContext.key !== "home" ? (
        <button type="button" className="oc-icon-btn" onClick={onHome} aria-label="Return to Studio Home" title="Return to Studio Home">
          <IconHome />
        </button>
      ) : null}
      <button
        type="button"
        className="oc-icon-btn"
        onClick={onNewSession}
        aria-label="New session"
        title="New session"
        disabled={!contextWritable}
      >
        <IconPlus />
      </button>
      {sessionID && busy ? (
        <button type="button" className="oc-icon-btn oc-icon-btn--warn" onClick={onAbort} aria-label="Stop" title="Stop">
          <IconStop />
        </button>
      ) : null}
      {!fullPage ? (
        <button type="button" data-autofocus className="oc-icon-btn" onClick={onClose} aria-label="Close agent" title="Close">
          <IconClose />
        </button>
      ) : null}
    </header>
  )
}
