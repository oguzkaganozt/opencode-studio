import { StudioNavLink, StudioShell } from "@ui/components/studio-shell"
import { studioHref } from "./api"

export function Shell({
  children,
  fill = false,
  hideProjectsNav = false,
}: {
  children: React.ReactNode
  fill?: boolean
  /** Only when project detail chrome already shows `← Projects`. */
  hideProjectsNav?: boolean
}) {
  return (
    <StudioShell
      studioId="pcb"
      label="PCB"
      fill={fill}
      nav={
        <>
          {!hideProjectsNav ? (
            <StudioNavLink to={studioHref()} end>
              Projects
            </StudioNavLink>
          ) : null}
          <StudioNavLink to={studioHref("catalog")}>Catalog</StudioNavLink>
        </>
      }
    >
      {children}
    </StudioShell>
  )
}
