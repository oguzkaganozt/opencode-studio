import type { ReactNode } from "react"
import { cn } from "../lib/cn"
import { statePanelClass } from "./state-panel"

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn(statePanelClass, "border-[var(--osc-error)]/40 bg-[var(--osc-error-bg)] py-12", className)} role="alert">
      <h2 className="text-pretty text-[15px] font-semibold text-[var(--osc-error)]">{title}</h2>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--osc-text-muted)]">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
