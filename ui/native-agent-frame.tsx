import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react"
import { getAgentContextDirectory, subscribeAgentContext } from "./agent-context"
import { subscribeAgentHandoff } from "./agent-handoff"
import { type AgentStatus, agentStatusDotClass, deriveAgentStatus } from "./agent-status"
import { AGENT_WIDTH_MAX, AGENT_WIDTH_MIN, clampAgentWidth, readAgentWidth, viewportAgentWidthMax, writeAgentWidth } from "./agent-width"
import { useFocusTrap } from "./lib/focus-trap"
import { nativeDirectoryUrl, nativeOpenCodeHomeUrl, nativePromptDraftUrl, resolveAgentDirectory } from "./native-agent-url"

function sameOriginPath(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin)
    if (url.origin !== window.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}` || nativeOpenCodeHomeUrl()
  } catch {
    return null
  }
}

export type NativeFrameSnapshot = {
  title?: string
  bodyText?: string
  hasAppRoot?: boolean
}

/** Detect proxy/auth JSON error bodies that still fire iframe onLoad. */
export function nativeFrameLooksBroken(snap: NativeFrameSnapshot | null | undefined): boolean {
  if (!snap) return true
  const title = (snap.title || "").trim().toLowerCase()
  if (title === "opencode") return false
  const bodyText = (snap.bodyText || "").trim()
  if (!bodyText) return true
  if (bodyText.startsWith("{") && /"error"\s*:/.test(bodyText)) return true
  if (/opencode_error|chat_auth_required|"unauthorized"/i.test(bodyText) && bodyText.length < 2000) return true
  if (snap.hasAppRoot) return false
  return bodyText.length < 80
}

export function snapshotFromDocument(doc: Document | null | undefined): NativeFrameSnapshot | null {
  if (!doc) return null
  return {
    title: doc.title,
    bodyText: doc.body?.innerText || doc.body?.textContent || "",
    hasAppRoot: Boolean(doc.getElementById("root") || doc.querySelector("[data-component], #app, main")),
  }
}

function useMdUp() {
  const [mdUp, setMdUp] = useState(() => (typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true))
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const onChange = () => setMdUp(mq.matches)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return mdUp
}

export function NativeAgentFrame({
  studioRoot,
  available,
  open,
  onClose,
  onStatusChange,
}: {
  studioRoot: string
  available: boolean
  open: boolean
  onClose: () => void
  onStatusChange?: (status: AgentStatus) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const widthRef = useRef(readAgentWidth())
  const mdUp = useMdUp()
  const [mounted, setMounted] = useState(false)
  const [src, setSrc] = useState(nativeOpenCodeHomeUrl())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [width, setWidth] = useState(() => readAgentWidth())
  const [dragging, setDragging] = useState(false)
  const [frameRevision, setFrameRevision] = useState(0)
  const [viewportMax, setViewportMax] = useState(() =>
    typeof window !== "undefined" ? viewportAgentWidthMax(window.innerWidth) : AGENT_WIDTH_MAX,
  )

  useEffect(() => {
    widthRef.current = width
  }, [width])

  useEffect(() => {
    const onResize = () => {
      const max = viewportAgentWidthMax(window.innerWidth)
      setViewportMax(max)
      setWidth((current) => {
        const next = clampAgentWidth(current, window.innerWidth)
        widthRef.current = next
        return next
      })
    }
    window.addEventListener("resize", onResize)
    onResize()
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const [contextDirectory, setContextDirectory] = useState(getAgentContextDirectory)
  const wasOpenRef = useRef(false)
  const skipDirectoryBindRef = useRef(false)

  useEffect(() => {
    return subscribeAgentContext(() => setContextDirectory(getAgentContextDirectory()))
  }, [])

  const bindDirectory = resolveAgentDirectory(contextDirectory, studioRoot)

  const navigateFrame = useCallback((next: string) => {
    setMounted(true)
    setLoading(true)
    setError(false)
    setSrc((prev) => (prev === next ? prev : next))
    const frame = iframeRef.current
    if (frame?.contentWindow) {
      try {
        frame.contentWindow.location.assign(next)
      } catch {
        // React src update still applies if the frame is not same-origin ready yet.
      }
    }
  }, [])

  // Open / rebind Agent to the active studio project (or Studio Home).
  useEffect(() => {
    if (!open || !available || !studioRoot) {
      if (!open) wasOpenRef.current = false
      return
    }
    const justOpened = !wasOpenRef.current
    wasOpenRef.current = true
    if (skipDirectoryBindRef.current) {
      skipDirectoryBindRef.current = false
      return
    }
    const next = nativeDirectoryUrl(bindDirectory)
    if (!justOpened && src === next) return
    navigateFrame(next)
  }, [open, available, studioRoot, bindDirectory, src, navigateFrame])

  useEffect(() => {
    return subscribeAgentHandoff((request) => {
      if (request.open === false) return

      if (!available || !studioRoot) {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(request.text).catch(() => {})
        }
        return
      }

      skipDirectoryBindRef.current = true
      const next = nativePromptDraftUrl(resolveAgentDirectory(request.directory, studioRoot), request.text)
      navigateFrame(next)
    })
  }, [available, studioRoot, navigateFrame])

  useEffect(() => {
    if (!open || !mdUp) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, mdUp, onClose])

  useFocusTrap(open && !mdUp, asideRef, onClose)

  const status = deriveAgentStatus({
    open,
    available,
    loading: open && available && mounted && loading && !error,
    error: open && available && error,
  })

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  const onFrameLoad = () => {
    setLoading(false)
    const frame = iframeRef.current
    let doc: Document | null = null
    try {
      doc = frame?.contentDocument ?? null
      const href = frame?.contentWindow?.location?.href
      if (href) {
        const path = sameOriginPath(href)
        if (path) setSrc(path)
      }
    } catch {
      setError(true)
      return
    }
    setError(nativeFrameLooksBroken(snapshotFromDocument(doc)))
  }

  const retryFrame = () => {
    setMounted(true)
    setError(false)
    setLoading(true)
    setFrameRevision((revision) => revision + 1)
  }

  const focusAgentFrame = () => {
    const frame = iframeRef.current
    if (frame) frame.focus({ preventScroll: true })
    else asideRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true })
  }

  const focusAgentClose = () => {
    asideRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true })
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const startX = event.clientX
    const startW = widthRef.current
    setDragging(true)
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // capture optional
    }

    const onMove = (moveEvent: PointerEvent) => {
      const next = clampAgentWidth(startW + (moveEvent.clientX - startX), window.innerWidth)
      widthRef.current = next
      setWidth(next)
    }
    const onUp = (upEvent: PointerEvent) => {
      setDragging(false)
      writeAgentWidth(widthRef.current)
      try {
        target.releasePointerCapture(upEvent.pointerId)
      } catch {
        // already released
      }
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointercancel", onUp)
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", onUp)
    target.addEventListener("pointercancel", onUp)
  }

  return (
    <aside
      ref={asideRef}
      aria-label="OpenCode agent"
      data-agent-open={open ? "true" : "false"}
      data-agent-width={width}
      className={`${open ? "flex" : "hidden"} absolute inset-0 z-30 min-h-0 w-full flex-col border-r border-[var(--osc-border)] bg-[var(--osc-bg)] md:static md:inset-auto md:shrink-0 ${dragging ? "select-none" : ""}`}
      style={open && mdUp ? { width, minWidth: AGENT_WIDTH_MIN, maxWidth: viewportMax } : undefined}
    >
      {!mdUp ? (
        <button type="button" className="sr-only" onFocus={focusAgentFrame}>
          Focus agent frame
        </button>
      ) : null}
      <div className="osc-agent-header">
        <span className={`size-1.5 shrink-0 rounded-full ${agentStatusDotClass(status)}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold tracking-[0.08em] uppercase">Agent</p>
          <p className="truncate text-[11px] leading-tight text-[var(--osc-text-muted)]">
            {available ? (loading ? "Connecting…" : error ? "Unavailable" : "OpenCode") : "Unavailable"}
          </p>
        </div>
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          className="osc-chip h-8 shrink-0 px-2.5 text-[11px]"
          aria-label="Close agent"
        >
          Close
        </button>
      </div>

      {!available ? (
        <div className="flex flex-1 flex-col justify-center gap-2 px-5 py-8 sm:p-6">
          <p className="text-[14px] font-medium text-[var(--osc-text)]">Native OpenCode UI is unavailable</p>
          <p className="max-w-sm text-[13px] leading-relaxed text-[var(--osc-text-muted)]">
            Start <code className="font-mono text-[11px]">opencode serve</code>, open a directory so the Studio plugin can attach, then
            reload. Prompt handoffs copy to the clipboard until the agent is available.
          </p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[var(--osc-bg)]">
          {error && (
            <div
              className="absolute inset-x-0 top-0 z-10 m-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--osc-radius-md)] border border-[var(--osc-error)]/40 bg-[var(--osc-bg-elevated)] p-3 text-[12px] text-[var(--osc-error)] shadow-[var(--osc-shadow)]"
              role="alert"
            >
              <span className="min-w-0 flex-1">Failed to reach the parent OpenCode UI. Confirm opencode serve is running, then retry.</span>
              <button type="button" className="osc-chip shrink-0" onClick={retryFrame}>
                Retry
              </button>
            </div>
          )}
          {loading && !error && (
            <div className="osc-agent-loading" role="status" aria-live="polite">
              <span className="sr-only">Loading agent…</span>
              <span className="osc-agent-loading__dot" aria-hidden />
            </div>
          )}
          {mounted && (
            <iframe
              key={frameRevision}
              ref={iframeRef}
              title="OpenCode agent"
              src={src}
              className="size-full border-0 bg-[var(--osc-bg)]"
              onLoad={onFrameLoad}
            />
          )}
        </div>
      )}

      {!mdUp ? (
        <button type="button" className="sr-only" onFocus={focusAgentClose}>
          Return to agent controls
        </button>
      ) : null}

      {open && mdUp && (
        // biome-ignore lint/a11y/useSemanticElements: vertical drag handle; hr is horizontal by default
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agent panel"
          aria-valuenow={width}
          aria-valuemin={AGENT_WIDTH_MIN}
          aria-valuemax={viewportMax}
          tabIndex={0}
          className="absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize touch-none border-0 bg-transparent hover:bg-[var(--osc-border-strong)] focus:bg-[var(--osc-border-strong)] focus:outline-none"
          onPointerDown={(event) => {
            event.preventDefault()
            beginResize(event)
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              const next = clampAgentWidth(width - 16, window.innerWidth)
              setWidth(next)
              writeAgentWidth(next)
            } else if (event.key === "ArrowRight") {
              event.preventDefault()
              const next = clampAgentWidth(width + 16, window.innerWidth)
              setWidth(next)
              writeAgentWidth(next)
            }
          }}
        />
      )}
    </aside>
  )
}
