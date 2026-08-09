import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { StudioNavLink, StudioShell } from "@ui/components/studio-shell"
import { api, studioHref } from "./api"

export function Shell({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <StudioShell
      studioId="pcb"
      label="PCB"
      fill={fill}
      trailing={<WorkspaceBadge />}
      nav={
        <>
          <StudioNavLink to={studioHref()} end>
            Projects
          </StudioNavLink>
          <StudioNavLink to={studioHref("catalog")}>Catalog</StudioNavLink>
        </>
      }
    >
      {children}
    </StudioShell>
  )
}

export function WorkspaceBadge() {
  const { data } = useQuery({ queryKey: ["pcb", "workspace"], queryFn: () => api.workspace() })
  if (!data) return null
  return (
    <span className="pcb-workspace-badge" title={data.root}>
      {data.root}
    </span>
  )
}

// ── Status badge ─────────────────────────────────────────────────────────────

