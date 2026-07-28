import type { HTMLAttributes } from "react"
import { cn } from "../lib/cn"

type BadgeTone = "neutral" | "ok" | "warn" | "fail"

const toneClass: Record<BadgeTone, string> = {
  neutral: "border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] text-[var(--osc-text-muted)]",
  ok: "border-[var(--osc-success)]/30 bg-[var(--osc-success-bg)] text-[var(--osc-success)]",
  warn: "border-[var(--osc-warning)]/30 bg-[var(--osc-warning-bg)] text-[var(--osc-warning)]",
  fail: "border-[var(--osc-error)]/30 bg-[var(--osc-error-bg)] text-[var(--osc-error)]",
}

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase",
        toneClass[tone],
        className,
      )}
      {...props}
    />
  )
}
