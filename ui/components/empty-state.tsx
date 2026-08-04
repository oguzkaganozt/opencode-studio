import type { ReactNode } from "react"
import { cn } from "../lib/cn"
import { statePanelClass } from "./state-panel"

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
  return (
    <div className={cn(statePanelClass, "border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)]/40 py-16", className)}>
      <h2 className="text-pretty text-[15px] font-medium text-[var(--osc-text)]">{title}</h2>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--osc-text-muted)]">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
