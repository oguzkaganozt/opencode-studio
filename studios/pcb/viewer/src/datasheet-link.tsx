import { safeHref } from "@ui/lib/safe-href"

export function DatasheetLink({
  href,
  className = "text-xs text-[var(--osc-accent)] hover:opacity-80",
}: {
  href: string | null | undefined
  className?: string
}) {
  const safe = href ? safeHref(href) : null
  if (!safe) return null
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
      Datasheet ↗
    </a>
  )
}
