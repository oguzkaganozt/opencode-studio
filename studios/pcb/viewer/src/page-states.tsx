import type { ReactNode } from "react"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-3 py-10" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="osc-skeleton h-16 w-full" aria-hidden />
      <div className="osc-skeleton h-16 w-full" aria-hidden />
      <div className="osc-skeleton h-16 w-3/4" aria-hidden />
    </div>
  )
}

export function PageError({ message, description, onRetry }: { message: string; description?: string; onRetry?: () => void }) {
  return (
    <ErrorState
      className="m-4 border-dashed py-16 sm:m-6 sm:py-20"
      title={message}
      description={description}
      action={
        onRetry ? (
          <button type="button" className="pcb-chip" onClick={onRetry}>
            Retry
          </button>
        ) : undefined
      }
    />
  )
}

export function PageEmpty({ label, description, action }: { label: string; description?: string; action?: React.ReactNode }) {
  return <EmptyState className="m-4 border-dashed py-16 sm:m-6 sm:py-20" title={label} description={description} action={action} />
}

// ── Projects Page ─────────────────────────────────────────────────────────────

