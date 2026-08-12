import { useQuery } from "@tanstack/react-query"
import { Component, lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router"
import { assertCatalogComplete, isStudioId, type StudioId } from "../src/core/registry"
import { AgentPanel } from "./agent/AgentPanel"
import { requestAgentHandoff } from "./agent-handoff"
import { Button } from "./components/button"
import { ErrorState } from "./components/error-state"
import { FilesExplorer } from "./files-explorer"
import { fetchJson } from "./lib/fetch-json"
import { useFocusTrap } from "./lib/focus-trap"
import { openStatusDialog } from "./status-dialog-state"
import { StatusDialogHost } from "./status-page"
import { clearStudioRuntime, setStudioRuntime } from "./studio-context"
import { readThemePreference, setThemePreference, type ThemePreference } from "./theme"
import { useStudioChrome } from "./use-studio-chrome"

type StudioCard = {
  id: string
  label: string
  description: string
  root: string | null
  rootError?: string
  requiredEngines: string[]
  skill: string
  skillInstalled: boolean
  agent: string
  agentInstalled: boolean
}

type StudiosResponse = {
  studioRoot: string
  configPath?: string
  configError?: string
  packageVersion: string
  studios: StudioCard[]
  restartRequiredHint: string
  nativeOpenCodeAvailable: boolean
}

const STUDIO_META: Record<string, { short: string; blurb: string }> = {
  cad: { short: "CAD", blurb: "Parts, assemblies, renders" },
  pcb: { short: "PCB", blurb: "Schematic, layout, BOM" },
  media: { short: "Media", blurb: "Image, audio, video" },
  fw: { short: "FW", blurb: "Build, sim, UART" },
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function StatusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.25 8.1 7.1 9.9 10.85 5.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? "size-6 text-[9px]" : "size-7 text-[10px]"
  return (
    <span
      className={`grid ${dim} place-items-center rounded-[var(--osc-radius-md)] bg-[var(--osc-primary)] font-semibold tracking-tight text-[var(--osc-primary-fg)]`}
    >
      os
    </span>
  )
}

function useStudios() {
  return useQuery({
    queryKey: ["host", "studios"],
    queryFn: () => fetchJson<StudiosResponse>("/api/studios"),
  })
}

function ThemePreferenceControl({ compact = false }: { compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference())

  return (
    <fieldset className={compact ? "osc-segmented osc-theme-toggle" : "osc-segmented"}>
      <legend className="sr-only">Theme</legend>
      {(
        [
          ["system", "System", "Sys"],
          ["light", "Light", "Light"],
          ["dark", "Dark", "Dark"],
        ] as const
      ).map(([value, label, short]) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            setPreference(value)
            setThemePreference(value)
          }}
          aria-pressed={preference === value}
          aria-label={label}
          title={label}
        >
          {compact ? (
            <>
              <span className="osc-theme-toggle__short">{short}</span>
              <span className="osc-theme-toggle__full">{label}</span>
            </>
          ) : (
            label
          )}
        </button>
      ))}
    </fieldset>
  )
}

function DrawerNavLink({
  to,
  active,
  onNavigate,
  title,
  blurb,
  accent,
}: {
  to: string
  active: boolean
  onNavigate: () => void
  title: string
  blurb?: string
  accent?: string
}) {
  return (
    <Link to={to} onClick={onNavigate} aria-current={active ? "page" : undefined} className="osc-nav-item" data-studio={accent}>
      <span className="osc-nav-item__rail" aria-hidden />
      <span className="osc-nav-item__title">
        {accent ? <span className="osc-nav-item__dot" aria-hidden /> : null}
        {title}
      </span>
      {blurb ? <span className="osc-nav-item__blurb">{blurb}</span> : null}
    </Link>
  )
}

function SideDrawer({ open, onClose, studioId }: { open: boolean; onClose: () => void; studioId?: string }) {
  const titleId = useId()
  const asideRef = useRef<HTMLElement>(null)
  const studiosQuery = useStudios()

  useFocusTrap(open, asideRef, onClose)

  const cards = studiosQuery.data?.studios ?? []

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-[var(--osc-overlay)] transition-opacity duration-[var(--osc-motion-duration)] ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!open}
        inert={open ? undefined : true}
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        className={`fixed inset-y-0 left-0 z-50 flex w-full max-w-full flex-col overscroll-contain border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow-md)] transition-transform duration-[var(--osc-motion-duration)] ease-[var(--osc-motion-ease)] sm:w-[min(22rem,92vw)] ${
          open ? "translate-x-0" : "pointer-events-none -translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        inert={open ? undefined : true}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--osc-border)] px-3 pt-[env(safe-area-inset-top,0px)]">
          <div className="flex min-w-0 items-center gap-2.5 px-0.5">
            <BrandMark />
            <span id={titleId} className="truncate text-[13px] font-semibold tracking-tight">
              opencode<span className="font-normal text-[var(--osc-text-muted)]"> studio</span>
            </span>
          </div>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            className="osc-icon-btn shrink-0 text-[var(--osc-text-muted)]"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-2" aria-label="Main">
          <div className="flex flex-col gap-0.5">
            <p className="osc-drawer-label px-2.5 pt-1.5 pb-1">Home</p>
            <DrawerNavLink
              to="/"
              active={!studioId || studioId === "home"}
              onNavigate={onClose}
              title="Agent"
              blurb="Sessions & chat"
              accent="agent"
            />
            <DrawerNavLink
              to="/files"
              active={studioId === "files"}
              onNavigate={onClose}
              title="Files"
              blurb="Home browser"
              accent="files"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="osc-drawer-label px-2.5 pt-0.5 pb-1">Studios</p>
            {studiosQuery.isLoading ? (
              <div className="flex flex-col gap-1.5 px-1 py-1" aria-busy="true">
                <span className="sr-only">Loading studios…</span>
                <div className="osc-skeleton h-12 w-full" aria-hidden />
                <div className="osc-skeleton h-12 w-full" aria-hidden />
              </div>
            ) : null}
            {!studiosQuery.isLoading && cards.length === 0 ? (
              <p className="px-2.5 py-2 text-[12px] text-[var(--osc-text-muted)]">No studios available.</p>
            ) : null}
            {cards.map((s) => {
              const meta = STUDIO_META[s.id]
              return (
                <DrawerNavLink
                  key={s.id}
                  to={`/studios/${s.id}`}
                  active={s.id === studioId}
                  onNavigate={onClose}
                  title={s.label}
                  blurb={meta?.blurb}
                  accent={s.id}
                />
              )
            })}
          </div>
        </nav>

        <div className="osc-drawer-footer">
          <button
            type="button"
            className="osc-drawer-status"
            onClick={() => {
              onClose()
              openStatusDialog()
            }}
          >
            <StatusIcon />
            Status
          </button>
        </div>
      </aside>
    </>
  )
}

function TopBar({
  studioLabel,
  studioId,
  menuOpen = false,
  onMenu,
  edge = "border",
  actions,
  /** Agent home: menu + actions only; session title lives in the panel header. */
  center = "auto",
}: {
  studioLabel?: string
  studioId?: string
  menuOpen?: boolean
  onMenu: () => void
  /** studio pages stack a subnav — drop the bottom border to avoid a double line */
  edge?: "border" | "flush"
  actions?: React.ReactNode
  center?: "auto" | "none"
}) {
  return (
    <header
      className={`sticky top-0 z-40 shrink-0 bg-[var(--osc-bg-elevated)] pt-[env(safe-area-inset-top,0px)] ${edge === "border" ? "border-b border-[var(--osc-border)]" : ""}`}
    >
      <div className="osc-topbar-inner">
        <button
          type="button"
          onClick={onMenu}
          className="osc-icon-btn"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
        >
          <MenuIcon />
        </button>
        {center === "none" ? (
          <div className="min-w-0 flex-1" />
        ) : studioLabel ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-0.5">
            {studioId && (
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--osc-accent-${studioId})` }} aria-hidden />
            )}
            <p className="truncate text-[14px] font-semibold tracking-tight text-[var(--osc-text)]">{studioLabel}</p>
          </div>
        ) : (
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 rounded-[var(--osc-radius-md)] px-1 py-1 transition-colors duration-[var(--osc-motion-duration)] hover:bg-[var(--osc-surface)] sm:gap-2.5"
          >
            <BrandMark />
            <span className="hidden truncate text-[13px] font-semibold tracking-tight min-[360px]:inline">
              opencode<span className="font-normal text-[var(--osc-text-muted)]"> studio</span>
            </span>
          </Link>
        )}
        <div className="osc-topbar-actions">
          {actions}
          <ThemePreferenceControl compact />
        </div>
      </div>
    </header>
  )
}

function OpenCodeFrame() {
  const studiosQuery = useStudios()
  const chrome = useStudioChrome()
  const available = studiosQuery.data?.nativeOpenCodeAvailable ?? false

  const agentChromeLeading = (
    <button
      type="button"
      onClick={chrome.openDrawer}
      className="oc-icon-btn"
      aria-label="Open menu"
      aria-expanded={chrome.drawerOpen}
      aria-haspopup="dialog"
    >
      <MenuIcon />
    </button>
  )
  const agentChromeTrailing = (
    <div className="oc-panel__chrome-actions">
      <ThemePreferenceControl compact />
    </div>
  )

  return (
    <div data-studio="opencode" className="studio-shell flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--osc-bg)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" inert={chrome.drawerOpen ? true : undefined}>
        <main
          id="main-content"
          data-testid="studio-main"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          tabIndex={-1}
        >
          <h1 className="sr-only">Agent</h1>
          {studiosQuery.isLoading || studiosQuery.isError ? (
            <>
              <header className="oc-panel__header oc-panel__header--page">
                {agentChromeLeading}
                <div className="oc-panel__title-wrap">
                  <p className="oc-panel__session-title">Agent</p>
                </div>
                {agentChromeTrailing}
              </header>
              {studiosQuery.isLoading ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6" role="status" aria-busy="true">
                  <span className="sr-only">Loading OpenCode…</span>
                  <div className="osc-skeleton h-10 w-full max-w-md" aria-hidden />
                  <div className="osc-skeleton min-h-48 flex-1" aria-hidden />
                </div>
              ) : (
                <div className="p-4 sm:p-8">
                  <ErrorState
                    title="Failed to load host"
                    description={(studiosQuery.error as Error)?.message ?? "unknown error"}
                    action={
                      <Button type="button" variant="outline" size="sm" onClick={() => void studiosQuery.refetch()}>
                        Retry
                      </Button>
                    }
                  />
                </div>
              )}
            </>
          ) : (
            <AgentPanel
              studioRoot={studiosQuery.data?.studioRoot ?? ""}
              available={available}
              open
              fullPage
              historyScope="studio"
              onClose={() => {}}
              headerLeading={agentChromeLeading}
              headerTrailing={agentChromeTrailing}
            />
          )}
        </main>
      </div>
      <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} />
    </div>
  )
}

const viewerLoaders: Record<StudioId, React.LazyExoticComponent<() => React.ReactNode>> = {
  cad: lazy(async () => {
    await import("@studios/cad/viewer/src/styles.css")
    const mod = await import("@studios/cad/viewer/src/app")
    return { default: mod.App }
  }),
  pcb: lazy(async () => {
    await import("@studios/pcb/viewer/src/styles.css")
    const mod = await import("@studios/pcb/viewer/src/app")
    return { default: mod.App }
  }),
  media: lazy(async () => {
    await import("@studios/media/viewer/src/styles.css")
    const mod = await import("@studios/media/viewer/src/app")
    return { default: mod.App }
  }),
  fw: lazy(async () => {
    await import("@studios/fw/viewer/src/styles.css")
    const mod = await import("@studios/fw/viewer/src/app")
    return { default: mod.App }
  }),
}

assertCatalogComplete(Object.keys(viewerLoaders), "viewerLoaders")

class ViewerRouteBoundary extends Component<{ children: React.ReactNode; studioLabel: string }, { error: boolean }> {
  state = { error: false }

  static getDerivedStateFromError() {
    return { error: true }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <ErrorState
        className="m-4 flex-1 sm:m-8"
        title={`${this.props.studioLabel} viewer failed to load`}
        description="Reload the viewer. The Studio menu remains available."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload viewer
          </Button>
        }
      />
    )
  }
}

function StudioFrame() {
  const { studioId = "" } = useParams()
  const studiosQuery = useStudios()
  const chrome = useStudioChrome({ openAgentOnHandoff: true })

  const uiBasePath = `/studios/${studioId}`
  const apiBasePath = `/api/studios/${studioId}`

  // Layout (not paint) so child useQuery effects see the new studio API base on CAD↔PCB nav.
  useLayoutEffect(() => {
    if (!studioId) return
    setStudioRuntime({ studioId, uiBase: uiBasePath, apiBase: apiBasePath })
    return () => {
      clearStudioRuntime()
    }
  }, [studioId, uiBasePath, apiBasePath])

  if (studiosQuery.isLoading) {
    return (
      <div className="flex min-h-dvh flex-col bg-[var(--osc-bg)]">
        <div className="flex min-h-0 flex-1 flex-col" inert={chrome.drawerOpen ? true : undefined}>
          <TopBar studioLabel="Loading…" menuOpen={chrome.drawerOpen} onMenu={chrome.openDrawer} />
          <main id="main-content" className="flex flex-1 flex-col gap-3 p-4 sm:p-6" role="status" aria-busy="true" tabIndex={-1}>
            <span className="sr-only">Loading studio…</span>
            <div className="osc-skeleton h-10 w-full max-w-md" aria-hidden />
            <div className="osc-skeleton min-h-48 flex-1" aria-hidden />
          </main>
        </div>
        <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId={studioId} />
      </div>
    )
  }
  if (!isStudioId(studioId)) {
    return <Navigate to="/" replace />
  }
  if (studiosQuery.isError || !studiosQuery.data) {
    return (
      <div className="flex min-h-dvh flex-col bg-[var(--osc-bg)]">
        <div inert={chrome.drawerOpen ? true : undefined}>
          <TopBar studioLabel="Studio" studioId={studioId} menuOpen={chrome.drawerOpen} onMenu={chrome.openDrawer} />
          <div className="p-4 sm:p-8">
            <ErrorState
              title="Failed to load studio host"
              description={(studiosQuery.error as Error)?.message ?? "unknown error"}
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => void studiosQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          </div>
        </div>
        <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId={studioId} />
      </div>
    )
  }

  const card = studiosQuery.data.studios.find((s) => s.id === studioId)
  const Viewer = viewerLoaders[studioId]
  const label = card?.label ?? studioId
  const nativeAvailable = studiosQuery.data.nativeOpenCodeAvailable
  const studioRoot = studiosQuery.data.studioRoot

  return (
    <div
      data-studio={studioId}
      data-agent-open={chrome.agentOpen ? "true" : "false"}
      className="studio-shell flex min-h-dvh flex-col bg-[var(--osc-bg)]"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={chrome.drawerOpen ? true : undefined}>
        <TopBar
          studioLabel={label}
          studioId={studioId}
          menuOpen={chrome.drawerOpen}
          onMenu={chrome.openDrawer}
          edge="flush"
          actions={
            <button
              type="button"
              onClick={chrome.toggleAgent}
              className="osc-chip osc-agent-chip"
              aria-pressed={chrome.agentOpen}
              aria-label={chrome.agentStatusLabel}
              title={chrome.agentStatusLabel}
            >
              <span className={`size-1.5 rounded-full ${chrome.agentStatusDotClass}`} aria-hidden />
              <span className="osc-agent-chip__label">Agent</span>
            </button>
          }
        />
        <div className="relative flex max-h-[calc(100dvh-var(--osc-chrome-h)-env(safe-area-inset-top,0px))] min-h-0 min-w-0 flex-1 overflow-hidden">
          <AgentPanel
            studioRoot={studioRoot}
            available={nativeAvailable}
            open={chrome.agentOpen}
            historyScope="directory"
            studioId={studioId}
            onClose={chrome.closeAgent}
            onStatusChange={chrome.setAgentStatus}
          />
          <main id="main-content" data-testid="studio-main" className="flex min-h-0 min-w-0 flex-1 flex-col" tabIndex={-1}>
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--osc-text-muted)]">Loading studio…</div>
              }
            >
              <ViewerRouteBoundary key={studioId} studioLabel={label}>
                <Viewer key={studioId} />
              </ViewerRouteBoundary>
            </Suspense>
          </main>
        </div>
      </div>
      <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId={studioId} />
    </div>
  )
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="osc-skip-link absolute top-0 left-3 z-[100] -translate-y-full rounded-[var(--osc-radius-md)] bg-[var(--osc-primary)] px-3 py-2 text-[12px] font-medium shadow-[var(--osc-shadow)] transition-transform duration-[var(--osc-motion-duration)] focus:translate-y-3 focus:outline-none focus-visible:shadow-[var(--osc-focus-ring)]"
    >
      Skip to main content
    </a>
  )
}

function FilesFrame() {
  const chrome = useStudioChrome()
  const studiosQuery = useStudios()
  const navigate = useNavigate()

  const requestFileAgent = (path: string) => {
    const directory = studiosQuery.data?.studioRoot
    if (!directory) return
    requestAgentHandoff({ text: "", source: "files", directory, paths: [path], open: true })
    navigate("/")
  }

  return (
    <div data-studio="files" className="studio-shell flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--osc-bg)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" inert={chrome.drawerOpen ? true : undefined}>
        <TopBar studioLabel="Files" studioId="files" menuOpen={chrome.drawerOpen} onMenu={chrome.openDrawer} edge="flush" />
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <main id="main-content" data-testid="studio-main" className="flex min-h-0 min-w-0 flex-1 flex-col" tabIndex={-1}>
            <h1 className="sr-only">Files</h1>
            <FilesExplorer onRequestAgent={studiosQuery.data?.studioRoot ? requestFileAgent : undefined} />
          </main>
        </div>
      </div>
      <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId="files" />
    </div>
  )
}

/** Legacy /status deep link → stay on home and open the dialog. */
function StatusDeepLink() {
  useEffect(() => {
    openStatusDialog()
  }, [])
  return <Navigate to="/" replace />
}

export function App() {
  const location = useLocation()

  useEffect(() => {
    const studioMatch = location.pathname.match(/^\/studios\/([^/]+)/)
    const title = location.pathname.startsWith("/files")
      ? "Files"
      : studioMatch
        ? (STUDIO_META[studioMatch[1]]?.short ?? studioMatch[1])
        : "Agent"
    document.title = `${title} · OpenCode Studio`
  }, [location.pathname])

  return (
    <>
      <SkipLink />
      <Routes>
        <Route path="/" element={<OpenCodeFrame />} />
        <Route path="/files/*" element={<FilesFrame />} />
        <Route path="/status" element={<StatusDeepLink />} />
        <Route path="/studios/:studioId/*" element={<StudioFrame />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <StatusDialogHost />
    </>
  )
}
