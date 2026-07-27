import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  icon,
  className,
}: {
  title?: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-xl border border-dashed border-[var(--osc-border-strong)] px-6 py-12 text-center",
        className,
      )}
      role="alert"
    >
      {icon ? <div className="mb-3 text-[var(--osc-error)]">{icon}</div> : null}
      <h2 className="text-[15px] font-semibold text-[var(--osc-text)]">{title}</h2>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] text-[var(--osc-text-muted)]">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
