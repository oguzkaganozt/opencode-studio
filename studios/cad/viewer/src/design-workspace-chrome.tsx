import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Badge } from "@ui/components/badge"
import { useFocusTrap } from "@ui/lib/focus-trap"
import { type DesignSummary, eventsUrl, renderUrl } from "./api"

export function designStatus(status: DesignSummary["buildStatus"]): {
  label: string
  badgeTone: "ok" | "warn" | "neutral"
  railTone: "success" | "warning" | "neutral"
} {
  if (status === "built") return { label: "built", badgeTone: "ok", railTone: "success" }
  if (status === "stale") return { label: "stale", badgeTone: "warn", railTone: "warning" }
  return { label: "unbuilt", badgeTone: "neutral", railTone: "neutral" }
}


export const CAD_COMPACT_WIDTH = 1120
export const CAD_PHONE_WIDTH = 640

export type Toast = { message: string; tone: "info" | "success" | "error" }

export function sceneMessageTone(message: string): Toast["tone"] {
  if (message === "Pair linked") return "success"
  if (message.startsWith("Drag to snap") || message.startsWith("Link: tap")) return "info"
  return "error"
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ReloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8A5.5 5.5 0 1 1 11.2 3.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M11 2.5v2.75h2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function useCadSpace() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  // null = not measured yet → treat as compact to avoid docked-inspector flash
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = rootRef.current
    const shell = el?.closest(".studio-shell") ?? document.querySelector(".studio-shell")
    const read = () => setAgentOpen(shell?.getAttribute("data-agent-open") === "true")
    read()
    if (!shell) return
    const mo = new MutationObserver(read)
    mo.observe(shell, { attributes: true, attributeFilter: ["data-agent-open"] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      setWidth(next > 0 ? next : null)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const narrow = width === null || width < CAD_COMPACT_WIDTH
  const phone = width === null || width < CAD_PHONE_WIDTH
  return { rootRef, compact: agentOpen || narrow, phone, width }
}

export type SheetPlacement = "side-left" | "side-right" | "bottom"

export function DesignsPanel({
  designs,
  selectedId,
  listStatus = "ready",
  listError,
  onRetry,
  onClose,
  onSelect,
  showClose,
}: {
  designs: DesignSummary[]
  selectedId?: string
  listStatus?: "loading" | "error" | "ready"
  listError?: string
  onRetry?: () => void
  onClose?: () => void
  onSelect: (id: string) => void
  showClose?: boolean
}) {
  return (
    <>
      <div className="cad-rail-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="cad-rail-label">Server designs</span>
          {listStatus === "ready" && designs.length > 0 ? (
            <span className="cad-rail-meta" aria-hidden>
              {designs.length}
            </span>
          ) : null}
        </div>
        {showClose && onClose ? (
          <button type="button" data-autofocus className="osc-icon-btn size-10 text-[var(--osc-text-muted)]" aria-label="Close designs" onClick={onClose}>
            <CloseIcon />
          </button>
        ) : null}
      </div>
      <nav className="cad-rail-scroll min-h-0 flex-1 overflow-auto overscroll-contain p-2" aria-label="Server designs">
        {listStatus === "loading" ? (
          <p className="cad-rail-empty" role="status">
            Loading designs…
          </p>
        ) : listStatus === "error" ? (
          <div className="cad-rail-empty" role="alert">
            <p>Could not load designs.</p>
            {listError ? <p className="mt-1 text-[12px] text-[var(--osc-text-muted)]">{listError}</p> : null}
            {onRetry ? (
              <button type="button" className="cad-rail-action mt-3" onClick={onRetry}>
                Retry
              </button>
            ) : null}
          </div>
        ) : designs.length === 0 ? (
          <p className="cad-rail-empty">
            No server designs yet.
            <span className="mt-1.5 block text-[12px] text-[var(--osc-text-muted)]">Build with the agent — finished designs show up here.</span>
          </p>
        ) : (
          designs.map((design) => {
            const active = design.id === selectedId
            const status = designStatus(design.buildStatus)
            return (
              <button
                key={design.id}
                type="button"
                data-active={active ? "true" : undefined}
                aria-current={active ? "true" : undefined}
                className={`cad-rail-link ${
                  active ? "" : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
                onClick={() => onSelect(design.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-left font-medium text-[var(--osc-text)]">{design.id}</span>
                  <Badge tone={status.badgeTone} className="shrink-0">
                    {status.label}
                  </Badge>
                </div>
                <div className="mono mt-0.5 text-left text-[10px] text-[var(--osc-text-faint)]">
                  {design.partCount} {design.partCount === 1 ? "part" : "parts"}
                </div>
              </button>
            )
          })
        )}
      </nav>
    </>
  )
}

export function PartsPanel({
  parts,
  highlightedPart,
  renders,
  showRenders,
  designId,
  onClose,
  onTogglePart,
  onSetAllVisible,
  onOpenRender,
  showClose,
}: {
  parts: Array<{ name: string; visible: boolean; color: number }>
  highlightedPart: number
  renders: string[]
  showRenders: boolean
  designId?: string
  onClose?: () => void
  onTogglePart: (index: number, visible: boolean) => void
  onSetAllVisible: (visible: boolean) => void
  onOpenRender: (url: string, label: string) => void
  showClose?: boolean
}) {
  const allVisible = parts.length > 0 && parts.every((p) => p.visible)
  const noneVisible = parts.length > 0 && parts.every((p) => !p.visible)

  return (
    <>
      <div className="cad-rail-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="cad-rail-label">Parts</span>
          {parts.length > 0 ? (
            <span className="cad-rail-meta" aria-hidden>
              {parts.filter((p) => p.visible).length}/{parts.length}
            </span>
          ) : null}
        </div>
        {showClose && onClose ? (
          <button type="button" data-autofocus className="osc-icon-btn size-10 text-[var(--osc-text-muted)]" aria-label="Close parts" onClick={onClose}>
            <CloseIcon />
          </button>
        ) : null}
      </div>
      {parts.length > 1 ? (
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-[var(--osc-border)] px-2 py-1.5">
          <button type="button" className="cad-ghost-btn" disabled={allVisible} onClick={() => onSetAllVisible(true)}>
            Show all
          </button>
          <button type="button" className="cad-ghost-btn" disabled={noneVisible} onClick={() => onSetAllVisible(false)}>
            Hide all
          </button>
        </div>
      ) : null}
      <ul className="cad-rail-scroll min-h-0 flex-1 overflow-auto overscroll-contain p-2">
        {parts.length === 0 ? (
          <li className="cad-rail-empty list-none">No parts loaded yet.</li>
        ) : (
          parts.map((part, index) => (
            <li key={`${part.name}-${index}`}>
              <button
                type="button"
                className={`cad-part-row hover:bg-[var(--osc-surface-hover)] ${
                  highlightedPart === index ? "bg-[var(--osc-surface)] text-[var(--osc-accent)]" : "text-[var(--osc-text)]"
                }`}
                aria-pressed={part.visible}
                aria-label={`${part.name} visibility`}
                onClick={() => onTogglePart(index, !part.visible)}
              >
                <span className={`cad-part-check${part.visible ? " is-on" : ""}`} aria-hidden />
                <span
                  className="cad-part-swatch"
                  style={{ background: `#${part.color.toString(16).padStart(6, "0")}` }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-left">{part.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      {showRenders ? (
        <>
          <div className="cad-section-label">
            <span>Renders</span>
            {renders.length > 0 ? <span className="cad-rail-meta normal-case tracking-normal">{renders.length}</span> : null}
          </div>
          {designId && renders.length > 0 ? (
            <div className="cad-render-grid cad-rail-scroll">
              {renders.map((file) => {
                const label = file.replace(/\.png$/, "")
                const url = renderUrl(designId, file)
                return (
                  <button key={file} type="button" title={label} className="cad-render-tile" onClick={() => onOpenRender(url, label)}>
                    <img src={url} alt={label} loading="lazy" width={160} height={120} />
                    <span className="cad-render-tile__label">{label}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="cad-render-empty">No renders generated</p>
          )}
        </>
      ) : null}
    </>
  )
}

export function SheetShell({
  open,
  placement,
  id,
  label,
  onClose,
  children,
}: {
  open: boolean
  placement: SheetPlacement
  id: string
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLElement>(null)
  useFocusTrap(open, panelRef, onClose)

  if (!open) return null

  const sideClass =
    placement === "side-left"
      ? "cad-sheet cad-sheet-left cad-sheet--side cad-sheet--left"
      : placement === "side-right"
        ? "cad-sheet cad-sheet-right cad-sheet--side cad-sheet--right"
        : "cad-sheet cad-sheet--bottom"

  return (
    <div className="cad-sheet-layer" role="presentation">
      <button type="button" tabIndex={-1} aria-hidden="true" className="cad-scrim" onClick={onClose} />
      <aside id={id} ref={panelRef} role="dialog" aria-modal="true" aria-label={label} className={`cad-rail ${sideClass}`}>
        {placement === "bottom" ? <div className="cad-sheet-handle" aria-hidden /> : null}
        {children}
      </aside>
    </div>
  )
}

export function useCadDesignEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const es = new EventSource(eventsUrl())
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as { type?: string; designId?: string }
        if (event.type === "designs-changed") {
          void queryClient.invalidateQueries({ queryKey: ["cad", "designs"] })
        }
        if (event.type === "design-changed" && event.designId) {
          void queryClient.invalidateQueries({ queryKey: ["cad", "designs"] })
          void queryClient.invalidateQueries({ queryKey: ["cad", "design", event.designId] })
        }
      } catch {
        // malformed event — ignore
      }
    }
    return () => es.close()
  }, [queryClient])
}

