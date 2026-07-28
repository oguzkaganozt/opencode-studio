import { type ReactNode, useRef } from "react"
import { cn } from "../lib/cn"
import { useFocusTrap } from "../lib/focus-trap"

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  overlayClassName,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  overlayClassName?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(open, panelRef, onClose)

  if (!open) return null

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-[var(--osc-overlay)] p-4", overlayClassName)}
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "max-h-[85vh] w-full max-w-2xl overflow-auto rounded-[var(--osc-radius-lg)] border border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow-md)] outline-none",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--osc-border)] px-5 py-4">
      <h2 className="min-w-0 truncate text-[15px] font-semibold text-[var(--osc-text)]">{title}</h2>
      <button
        type="button"
        data-autofocus
        onClick={onClose}
        className="osc-icon-btn size-8 text-[var(--osc-text-muted)]"
        aria-label="Close dialog"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
