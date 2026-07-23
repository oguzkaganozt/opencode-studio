import type { HTMLAttributes } from "react"
import { cn } from "../../lib/utils"

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#b8beb1]",
        className,
      )}
      {...props}
    />
  )
}
