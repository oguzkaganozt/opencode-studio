import type { HTMLAttributes } from "react"
import { cn } from "../lib/cn"

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)]/90 px-2 py-0.5 font-mono text-[10px] tracking-wide text-[var(--osc-text-muted)] uppercase backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  )
}
