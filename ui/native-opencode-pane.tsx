import { useRef, useState } from "react"
import { Button } from "./components/button"
import { nativeFrameLooksBroken, snapshotFromDocument } from "./native-agent-frame"
import { nativeOpenCodeHomeUrl } from "./native-agent-url"

/** Full-bleed same-origin OpenCode UI (parent proxied at `/`). */
export function NativeOpenCodePane({ available }: { available: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [frameKey, setFrameKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = () => {
    setLoading(true)
    setError(false)
    setFrameKey((k) => k + 1)
  }

  if (!available) {
    return (
      <div data-studio="opencode" className="absolute inset-0 flex flex-col justify-center gap-2 px-5 py-10 sm:px-8">
        <p className="text-[14px] font-medium text-[var(--osc-text)]">Native OpenCode UI is unavailable</p>
        <p className="max-w-md text-[13px] leading-relaxed text-[var(--osc-text-muted)]">
          Start <code className="font-mono text-[11px]">opencode serve</code>, open a directory so the Studio plugin can attach, then
          reload.
        </p>
      </div>
    )
  }

  // Fill main-content (position:relative). Default iframe height is 150px — never rely on h-full alone.
  return (
    <div data-studio="opencode" className="absolute inset-0 min-h-0 min-w-0 bg-[var(--osc-bg)]">
      {error && (
        <div
          className="absolute inset-x-0 top-0 z-10 m-3 flex flex-wrap items-start justify-between gap-2 rounded-[var(--osc-radius-md)] border border-[var(--osc-error)]/40 bg-[var(--osc-bg-elevated)] p-3 text-[12px] text-[var(--osc-error)] shadow-[var(--osc-shadow)]"
          role="alert"
        >
          <p className="min-w-0 flex-1">Failed to reach the parent OpenCode UI. Confirm opencode serve is running, then retry.</p>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
      {loading && !error && (
        <div className="osc-agent-loading" role="status" aria-live="polite">
          <span className="sr-only">Loading OpenCode…</span>
          <span className="osc-agent-loading__dot" aria-hidden />
        </div>
      )}
      <iframe
        key={frameKey}
        ref={iframeRef}
        title="OpenCode"
        src={nativeOpenCodeHomeUrl()}
        className="block h-full w-full border-0 bg-[var(--osc-bg)]"
        onLoad={() => {
          setLoading(false)
          const frame = iframeRef.current
          let doc: Document | null = null
          try {
            doc = frame?.contentDocument ?? null
          } catch {
            setError(true)
            return
          }
          setError(nativeFrameLooksBroken(snapshotFromDocument(doc)))
        }}
      />
    </div>
  )
}
