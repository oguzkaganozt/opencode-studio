import { useEffect, useRef, useState } from "react"
import { subscribeAgentHandoff } from "./agent-handoff"
import { type AgentStatus, agentStatusDotClass, deriveAgentStatus } from "./agent-status"
import { nativeOpenCodeHomeUrl, nativePromptDraftUrl } from "./native-agent-url"

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

function snapshotFromDocument(doc: Document | null | undefined): NativeFrameSnapshot | null {
  if (!doc) return null
  return {
    title: doc.title,
    bodyText: doc.body?.innerText || doc.body?.textContent || "",
    hasAppRoot: Boolean(doc.getElementById("root") || doc.querySelector("[data-component], #app, main")),
  }
}

export function NativeAgentFrame({
  workspace,
  available,
  open,
  onClose,
  onStatusChange,
}: {
  workspace: string
  available: boolean
  open: boolean
  onClose: () => void
  onStatusChange?: (status: AgentStatus) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [mounted, setMounted] = useState(false)
  const [src, setSrc] = useState(nativeOpenCodeHomeUrl())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!(open && available) || mounted) return
    setMounted(true)
    setLoading(true)
    setError(false)
  }, [open, available, mounted])

  useEffect(() => {
    return subscribeAgentHandoff((request) => {
      if (request.open === false) return

      if (!available || !workspace) {
        // Attach mode / no native UI: preserve the prompt via clipboard.
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(request.text).catch(() => {})
        }
        return
      }

      const next = nativePromptDraftUrl(workspace, request.text)
      setMounted(true)
      setLoading(true)
      setError(false)
      setSrc(next)

      const frame = iframeRef.current
      if (frame?.contentWindow) {
        try {
          // Force navigation when the frame is already mounted (same src string would no-op in React).
          frame.contentWindow.location.assign(next)
        } catch {
          // React src update still applies if the frame is not same-origin ready yet.
        }
      }
    })
  }, [available, workspace])

  useEffect(() => {
    if (!open) return
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
  }, [open, onClose])

  const status = deriveAgentStatus({
    open,
    available,
    loading: open && available && mounted && loading && !error,
    error: open && available && error,
  })

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  const openHref = src === nativeOpenCodeHomeUrl() ? "/" : src

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
      // Cross-origin should not happen for same-origin proxy; treat as failure.
      setError(true)
      return
    }
    setError(nativeFrameLooksBroken(snapshotFromDocument(doc)))
  }

  return (
    <aside
      aria-label="OpenCode agent"
      data-agent-open={open ? "true" : "false"}
      className={`${open ? "flex" : "hidden"} absolute inset-0 z-30 min-h-0 w-full flex-col border-r border-[var(--osc-border)] bg-[var(--osc-bg)] md:static md:w-[min(420px,42vw)] md:shrink-0`}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--osc-border)] px-3">
        <span className={`size-1.5 shrink-0 rounded-full ${agentStatusDotClass(status)}`} aria-hidden />
        <span className="shrink-0 text-[12px] font-semibold tracking-[0.1em] uppercase">Agent</span>
        <span className="ml-auto truncate text-[11px] text-[var(--osc-text-muted)]">{available ? "OpenCode" : "Unavailable"}</span>
        {available && (
          <a
            href={openHref}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border border-[var(--osc-border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--osc-surface)]"
          >
            Open
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-[var(--osc-border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--osc-surface)]"
          aria-label="Close agent"
        >
          Close
        </button>
      </div>

      {!available ? (
        <div className="flex flex-1 flex-col justify-center gap-2 p-4">
          <p className="text-[13px] font-medium text-[var(--osc-text)]">Native OpenCode UI is unavailable</p>
          <p className="text-[12px] leading-relaxed text-[var(--osc-text-muted)]">
            This host is attached to a shared OpenCode server (`OPENCODE_STUDIO_OPENCODE_URL`). Native UI proxying is disabled there to
            avoid leaking events across workspaces. Open that server&apos;s own URL for the full agent UI, or run Studio without attach mode
            so it owns a loopback sidecar. Prompt handoffs copy to the clipboard instead.
          </p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[var(--osc-bg)]">
          {error && (
            <div className="absolute inset-x-0 top-0 z-10 m-3 rounded-lg border border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)] p-3 text-[12px] text-[var(--osc-error)]">
              Failed to reach the native OpenCode UI. Check that the host sidecar is running, then reopen the agent.
            </div>
          )}
          {mounted && (
            <iframe
              ref={iframeRef}
              title="OpenCode agent"
              src={src}
              className="size-full border-0 bg-[var(--osc-bg)]"
              onLoad={onFrameLoad}
            />
          )}
        </div>
      )}
    </aside>
  )
}
