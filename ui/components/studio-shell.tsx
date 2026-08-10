import type { ReactNode } from "react"
import { Link, useLocation } from "react-router"
import { cn } from "../lib/cn"

export function StudioShell({
  studioId,
  label,
  nav,
  trailing,
  fill = false,
  children,
}: {
  studioId: string
  label: string
  nav?: ReactNode
  trailing?: ReactNode
  fill?: boolean
  children: ReactNode
}) {
  return (
    <div data-studio={studioId} className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)] text-[var(--osc-text)]">
      {nav || trailing ? (
        <header className="studio-subnav">
          <span className="sr-only">{label} Studio</span>
          {nav ? (
            <nav className="flex items-center gap-0.5" aria-label={`${label} sections`}>
              {nav}
            </nav>
          ) : null}
          {trailing}
        </header>
      ) : null}
      <div className={cn("min-h-0 flex-1", fill ? "flex flex-col overflow-hidden" : "overflow-auto")}>{children}</div>
    </div>
  )
}

export function StudioNavLink({
  to,
  children,
  end = false,
  endAlsoMatch,
  className,
}: {
  to: string
  children: ReactNode
  end?: boolean
  /** Extra active when end=true (e.g. CAD Designs stays active on /designs/:id). */
  endAlsoMatch?: (path: string, target: string) => boolean
  className?: string
}) {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/$/, "") || "/"
  const target = (to || "/").replace(/\/$/, "") || "/"
  const active = end ? path === target || Boolean(endAlsoMatch?.(path, target)) : path === target || path.startsWith(`${target}/`)
  return (
    <Link to={to} aria-current={active ? "page" : undefined} className={cn(active && "font-medium", className)}>
      {children}
    </Link>
  )
}
