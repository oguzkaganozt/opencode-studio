import { StudioNavLink, StudioShell } from "@ui/components/studio-shell"
import { studioHref } from "./api"

export function Shell({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <StudioShell
      studioId="pcb"
      label="PCB"
      fill={fill}
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
