import type { ReactNode } from "react"
import { cn } from "../lib/cn"
import { statePanelClass } from "./state-panel"

type StateTone = "empty" | "error"

const toneClass: Record<StateTone, string> = {
  empty: "border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)]/40 py-16",
  error: "border-[var(--osc-error)]/40 bg-[var(--osc-error-bg)] py-12",
}

const titleClass: Record<StateTone, string> = {
  empty: "text-pretty text-[15px] font-medium text-[var(--osc-text)]",
  error: "text-pretty text-[15px] font-semibold text-[var(--osc-error)]",
}

export function StatePanel({
  tone,
  title,
  description,
  action,
  className,
}: {
  tone: StateTone
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn(statePanelClass, toneClass[tone], className)} role={tone === "error" ? "alert" : undefined}>
      <h2 className={titleClass[tone]}>{title}</h2>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--osc-text-muted)]">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return <StatePanel tone="empty" title={title} description={description} action={action} className={className} />
}
