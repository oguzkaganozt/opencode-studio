import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--osc-radius-lg)] border border-dashed border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)]/40 px-6 py-16 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-3 text-[var(--osc-text-muted)]">{icon}</div> : null}
      <h2 className="text-pretty text-[15px] font-medium text-[var(--osc-text)]">{title}</h2>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--osc-text-muted)]">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
