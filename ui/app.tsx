import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Component, lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router"
import { isStudioId, STUDIO_IDS, type StudioId } from "../src/core/registry"
import { Badge } from "./components/badge"
import { Button } from "./components/button"
import { ErrorState } from "./components/error-state"
import { FilesExplorer } from "./files-explorer"
import { fetchJson } from "./lib/fetch-json"
import { useFocusTrap } from "./lib/focus-trap"
import { NativeAgentFrame } from "./native-agent-frame"
import { NativeOpenCodePane } from "./native-opencode-pane"
import { clearStudioRuntime, setStudioRuntime } from "./studio-context"
import { readThemePreference, setThemePreference, type ThemePreference } from "./theme"
import { type DrawerPanel, useStudioChrome } from "./use-studio-chrome"

type StudioCard = {
  id: string
  label: string
  description: string
  enabled: boolean
  root: string | null
  rootError?: string
  requiredEngines: string[]
  skill: string
  skillInstalled: boolean
}

type HostCheck = {
  id: string
  status: "pass" | "warn" | "fail"
  message: string
  repair?: string
}

type UpdateInfo = {
  current: string
  latest: string | null
  updateAvailable: boolean
  message?: string
}

type StudiosResponse = {
  workspace: string
  configPath?: string
  enabled: string[]
  configError?: string
  packageVersion: string
  studios: StudioCard[]
  checks?: HostCheck[]
  ok?: boolean
  restartRequiredHint: string
  nativeOpenCodeAvailable: boolean
  update?: UpdateInfo
}

const STUDIO_META: Record<string, { short: string; blurb: string }> = {
  cad: { short: "CAD", blurb: "Parts, assemblies, renders" },
  pcb: { short: "PCB", blurb: "Schematic, layout, BOM" },
}

function checkTone(status: HostCheck["status"] | "unknown"): "ok" | "warn" | "fail" | "neutral" {
  if (status === "pass") return "ok"
  if (status === "warn") return "warn"
  if (status === "fail") return "fail"
  return "neutral"
}

function studioHealth(studio: StudioCard, checks: HostCheck[]) {
  const skillCheck = checks.find((check) => check.id === `skill:${studio.id}`)
  const skillStatus = skillCheck?.status ?? (studio.skillInstalled ? "pass" : "fail")
  const engines = studio.requiredEngines.map((engine) => {
    const check = checks.find((item) => item.id === `engine:${studio.id}:${engine}`)
    return { engine, status: check?.status ?? ("unknown" as const), message: check?.message }
  })
  const rootBad = Boolean(studio.rootError)
  const worst: HostCheck["status"] | "unknown" = rootBad
    ? "fail"
    : skillStatus === "fail" || engines.some((e) => e.status === "fail")
      ? "fail"
      : skillStatus === "warn" || engines.some((e) => e.status === "warn")
        ? "warn"
        : skillStatus === "pass" && engines.every((e) => e.status === "pass" || e.status === "unknown")
          ? "pass"
          : "unknown"

  return {
    status: worst,
    label: worst === "pass" ? "Ready" : worst === "warn" ? "Review" : worst === "fail" ? "Action needed" : "Checking",
    skill: {
      status: skillStatus,
      message: skillCheck?.message ?? (studio.skillInstalled ? "Installed" : "Not installed"),
    },
    engines,
  }
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

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 2.5v1.4M9 14.1v1.4M2.5 9h1.4M14.1 9h1.4M4.4 4.4l1 1M12.6 12.6l1 1M13.6 4.4l-1 1M5.4 12.6l-1 1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
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

function useCsrf() {
  return useQuery({
    queryKey: ["host", "csrf"],
    queryFn: () => fetchJson<{ token: string }>("/api/csrf"),
  })
}

function useRepairInstall() {
  const queryClient = useQueryClient()
  const csrfQuery = useCsrf()
  return useMutation({
    mutationFn: async () => {
      const token = csrfQuery.data?.token
      if (!token) throw new Error("CSRF token unavailable")
      return fetchJson<{ message?: string; restartRequired?: boolean }>("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
        },
        body: JSON.stringify({}),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["host"] })
    },
  })
}

function ThemePreferenceControl() {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference())

  return (
    <fieldset className="osc-setting-card">
      <legend className="sr-only">Theme</legend>
      <div>
        <p className="osc-setting-card__title">Theme</p>
        <p className="osc-setting-card__description">Use your device setting or choose a fixed theme.</p>
      </div>
      <div className="mt-3">
        <div className="osc-segmented">
          {(
            [
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setPreference(value)
                setThemePreference(value)
              }}
              aria-pressed={preference === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
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

function SideDrawer({
  open,
  onClose,
  studioId,
  initialPanel = "nav",
}: {
  open: boolean
  onClose: () => void
  studioId?: string
  initialPanel?: DrawerPanel
}) {
  const titleId = useId()
  const asideRef = useRef<HTMLElement>(null)
  const studiosQuery = useStudios()
  const csrfQuery = useCsrf()
  const repair = useRepairInstall()
  const [panel, setPanel] = useState<DrawerPanel>(initialPanel)

  useEffect(() => {
    if (open) setPanel(initialPanel)
  }, [open, initialPanel])

  useFocusTrap(open, asideRef, onClose)

  const cards = studiosQuery.data?.studios ?? []
  const healthRows = cards.map((studio) => ({ studio, health: studioHealth(studio, studiosQuery.data?.checks ?? []) }))
  const hostFindings = studiosQuery.data?.checks?.filter((check) => check.status !== "pass") ?? []
  const healthStatus =
    studiosQuery.isError ||
    studiosQuery.data?.configError ||
    studiosQuery.data?.ok === false ||
    healthRows.some(({ health }) => health.status === "fail")
      ? "fail"
      : healthRows.some(({ health }) => health.status === "warn")
        ? "warn"
        : "pass"

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

        <div className="shrink-0 border-b border-[var(--osc-border)] p-2">
          <div className="osc-segmented" role="tablist" aria-label="Menu sections">
            {(
              [
                ["nav", "Navigate"],
                ["settings", "Settings"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                id={`osc-drawer-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={panel === id}
                aria-controls={`osc-drawer-panel-${id}`}
                tabIndex={panel === id ? 0 : -1}
                onClick={() => setPanel(id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home"
                      ? "nav"
                      : event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End"
                        ? "settings"
                        : null
                  if (!next) return
                  event.preventDefault()
                  setPanel(next)
                  queueMicrotask(() => document.getElementById(`osc-drawer-tab-${next}`)?.focus())
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === "nav" && (
            <nav
              id="osc-drawer-panel-nav"
              className="flex flex-col gap-4 p-2 pb-4"
              role="tabpanel"
              aria-labelledby="osc-drawer-tab-nav"
              aria-label="Studios"
            >
              <div className="flex flex-col gap-0.5">
                <p className="osc-drawer-label px-2.5 pt-1.5 pb-1">Workspace</p>
                <DrawerNavLink to="/" active={!studioId} onNavigate={onClose} title="OpenCode" blurb="Agent & sessions" />
                <DrawerNavLink
                  to="/files"
                  active={studioId === "files"}
                  onNavigate={onClose}
                  title="Files"
                  blurb="Workspace browser"
                  accent="files"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="osc-drawer-label px-2.5 pt-0.5 pb-1">Studios</p>
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
          )}

          {panel === "settings" && (
            <div id="osc-drawer-panel-settings" className="osc-settings" role="tabpanel" aria-labelledby="osc-drawer-tab-settings">
              <section className="osc-settings-section" aria-labelledby="osc-appearance-label">
                <div className="osc-settings-heading">
                  <h2 id="osc-appearance-label">Appearance</h2>
                  <p>Personalize how Studio looks.</p>
                </div>
                <ThemePreferenceControl />
              </section>

              <section className="osc-settings-section" aria-labelledby="osc-health-label">
                <div className="osc-settings-heading">
                  <h2 id="osc-health-label">System health</h2>
                  <p>Studio integrations and required tools.</p>
                </div>

                {studiosQuery.isLoading ? (
                  <div className="osc-health-summary" role="status" aria-busy="true">
                    <span className="osc-status-dot" data-status="unknown" aria-hidden />
                    <div>
                      <p>Checking installation</p>
                      <span>Reading Studio configuration…</span>
                    </div>
                  </div>
                ) : (
                  <div className="osc-health-card">
                    <div className="osc-health-summary">
                      <span className="osc-status-dot" data-status={healthStatus} aria-hidden />
                      <div>
                        <p>
                          {studiosQuery.isError || studiosQuery.data?.configError
                            ? "Configuration needs attention"
                            : studiosQuery.data?.ok === false
                              ? "Installation needs attention"
                              : healthStatus === "fail"
                                ? "Action needed"
                                : healthStatus === "warn"
                                  ? "Review recommended"
                                  : "Everything is ready"}
                        </p>
                        <span>
                          {studiosQuery.isError
                            ? "Studio status could not be loaded."
                            : studiosQuery.data?.configError
                              ? "Review the configuration error below."
                              : studiosQuery.data?.ok === false
                                ? "Open a studio status row or Advanced for details."
                                : "CAD and PCB are available in this workspace."}
                        </span>
                      </div>
                    </div>

                    {healthRows.map(({ studio, health }) => {
                      return (
                        <details key={studio.id} className="osc-health-row">
                          <summary>
                            <span className="osc-health-row__identity">
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ background: `var(--osc-accent-${studio.id})` }}
                                aria-hidden
                              />
                              <span>{studio.label}</span>
                            </span>
                            <Badge tone={checkTone(health.status)}>{health.label}</Badge>
                          </summary>
                          <dl className="osc-health-details">
                            <div>
                              <dt>Skill</dt>
                              <dd>{health.skill.message}</dd>
                            </div>
                            {health.engines.map((engine) => (
                              <div key={engine.engine}>
                                <dt>{engine.engine}</dt>
                                <dd>{engine.message ?? (engine.status === "unknown" ? "Checking" : engine.status)}</dd>
                              </div>
                            ))}
                            {studio.rootError && (
                              <div>
                                <dt>Root</dt>
                                <dd>{studio.rootError}</dd>
                              </div>
                            )}
                          </dl>
                        </details>
                      )
                    })}
                  </div>
                )}

                {studiosQuery.isError && (
                  <p className="osc-settings-alert" data-tone="error" role="alert">
                    {(studiosQuery.error as Error)?.message ?? "Could not load Studio status."}
                  </p>
                )}
                {studiosQuery.data?.configError && (
                  <p className="osc-settings-alert" data-tone="error" role="alert">
                    {studiosQuery.data.configError}
                  </p>
                )}
                {studiosQuery.data?.update?.updateAvailable && (
                  <div className="osc-update-card" role="status">
                    <div>
                      <p>Update available</p>
                      <span>
                        v{studiosQuery.data.update.current} → v{studiosQuery.data.update.latest}
                      </span>
                    </div>
                    <code>opencode-studio upgrade</code>
                  </div>
                )}
              </section>

              <section className="osc-settings-section" aria-labelledby="osc-advanced-label">
                <details className="osc-advanced">
                  <summary>
                    <span>
                      <strong id="osc-advanced-label">Advanced</strong>
                      <small>Version, paths and installation repair</small>
                    </span>
                  </summary>
                  <div className="osc-advanced__content">
                    {hostFindings.length > 0 && (
                      <div className="osc-install-findings" role="status">
                        <p>Installation findings</p>
                        <ul>
                          {hostFindings.map((finding) => (
                            <li key={finding.id}>{finding.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {studiosQuery.data && (
                      <dl className="osc-install-meta">
                        <div>
                          <dt>Version</dt>
                          <dd>v{studiosQuery.data.packageVersion}</dd>
                        </div>
                        <div>
                          <dt>Workspace</dt>
                          <dd title={studiosQuery.data.workspace}>{studiosQuery.data.workspace}</dd>
                        </div>
                        {studiosQuery.data.configPath && (
                          <div>
                            <dt>Config</dt>
                            <dd title={studiosQuery.data.configPath}>{studiosQuery.data.configPath}</dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {cards.length > 0 && (
                      <div className="osc-path-list">
                        {cards.map((studio) => (
                          <details key={studio.id}>
                            <summary>{studio.label} details</summary>
                            <dl>
                              <div>
                                <dt>Root</dt>
                                <dd>{studio.root ?? studio.rootError ?? "—"}</dd>
                              </div>
                              <div>
                                <dt>Skill</dt>
                                <dd>{studio.skillInstalled ? studio.skill : `${studio.skill} (not installed)`}</dd>
                              </div>
                              <div>
                                <dt>Engines</dt>
                                <dd>{studio.requiredEngines.join(", ") || "None"}</dd>
                              </div>
                            </dl>
                          </details>
                        ))}
                      </div>
                    )}

                    <div className="osc-repair">
                      <div>
                        <p>Repair installation</p>
                        <span>Reinstall managed plugins, skills and MCP configuration.</span>
                      </div>
                      {csrfQuery.isError && (
                        <p className="osc-settings-alert" data-tone="error" role="alert">
                          Repair is unavailable in this session.
                        </p>
                      )}
                      {repair.isSuccess && (
                        <p className="osc-settings-alert" data-tone="warning" role="status">
                          {studiosQuery.data?.restartRequiredHint ?? "Restart OpenCode to finish the repair."}
                        </p>
                      )}
                      {repair.isError && (
                        <p className="osc-settings-alert" data-tone="error" role="alert">
                          {(repair.error as Error).message}
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        disabled={repair.isPending || !csrfQuery.data}
                        onClick={() => repair.mutate()}
                      >
                        {repair.isPending ? "Repairing…" : "Repair installation"}
                      </Button>
                    </div>
                  </div>
                </details>
              </section>
            </div>
          )}
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
  onSettings,
  edge = "border",
  actions,
}: {
  studioLabel?: string
  studioId?: string
  menuOpen?: boolean
  onMenu: () => void
  onSettings?: () => void
  /** studio pages stack a subnav — drop the bottom border to avoid a double line */
  edge?: "border" | "flush"
  actions?: React.ReactNode
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
        {studioLabel ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-0.5">
            {studioId && (
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--osc-accent-${studioId})` }} aria-hidden />
            )}
            <h1 className="truncate text-[14px] font-semibold tracking-tight text-[var(--osc-text)]">{studioLabel}</h1>
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
          {onSettings && (
            <button type="button" onClick={onSettings} className="osc-icon-btn text-[var(--osc-text-muted)]" aria-label="Open settings">
              <SettingsIcon />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function OpenCodeFrame() {
  const studiosQuery = useStudios()
  const chrome = useStudioChrome()
  const available = studiosQuery.data?.nativeOpenCodeAvailable ?? false

  return (
    <div data-studio="opencode" className="studio-shell flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--osc-bg)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" inert={chrome.drawerOpen ? true : undefined}>
        <TopBar
          studioLabel="OpenCode"
          menuOpen={chrome.drawerOpen}
          onMenu={() => chrome.openDrawer("nav")}
          onSettings={() => chrome.openDrawer("settings")}
          edge="flush"
        />
        <main id="main-content" data-testid="studio-main" className="relative min-h-0 min-w-0 flex-1 overflow-hidden" tabIndex={-1}>
          {studiosQuery.isLoading ? (
            <div className="flex h-full flex-col gap-3 p-4 sm:p-6" role="status" aria-busy="true">
              <span className="sr-only">Loading OpenCode…</span>
              <div className="osc-skeleton h-10 w-full max-w-md" aria-hidden />
              <div className="osc-skeleton min-h-48 flex-1" aria-hidden />
            </div>
          ) : studiosQuery.isError ? (
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
          ) : (
            <NativeOpenCodePane available={available} />
          )}
        </main>
      </div>
      <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} initialPanel={chrome.drawerPanel} />
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
}

function assertViewerLoadersComplete() {
  const expected = [...STUDIO_IDS].sort()
  const actual = Object.keys(viewerLoaders).sort()
  if (expected.length !== actual.length || expected.some((id, i) => id !== actual[i])) {
    throw new Error(`viewerLoaders must match catalog exactly. expected=${expected.join(",")} actual=${actual.join(",")}`)
  }
}
assertViewerLoadersComplete()

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
        description="Reload the viewer. The Studio menu and settings remain available."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload viewer
          </Button>
        }
      />
    )
  }
}

function AgentChromeActions({
  agentOpen,
  agentStatusLabel: statusLabel,
  agentStatusDotClass: statusDot,
  onToggle,
}: {
  agentOpen: boolean
  agentStatusLabel: string
  agentStatusDotClass: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="osc-chip"
      aria-pressed={agentOpen}
      aria-label={`Agent, ${statusLabel}`}
      title={statusLabel}
    >
      <span className={`size-1.5 rounded-full ${statusDot}`} aria-hidden />
      Agent
    </button>
  )
}

function StudioFrame() {
  const { studioId = "" } = useParams()
  const studiosQuery = useStudios()
  const chrome = useStudioChrome()

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
          <TopBar
            studioLabel="Loading…"
            menuOpen={chrome.drawerOpen}
            onMenu={() => chrome.openDrawer("nav")}
            onSettings={() => chrome.openDrawer("settings")}
          />
          <main id="main-content" className="flex flex-1 flex-col gap-3 p-4 sm:p-6" role="status" aria-busy="true" tabIndex={-1}>
            <span className="sr-only">Loading studio…</span>
            <div className="osc-skeleton h-10 w-full max-w-md" aria-hidden />
            <div className="osc-skeleton min-h-48 flex-1" aria-hidden />
          </main>
        </div>
        <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId={studioId} initialPanel={chrome.drawerPanel} />
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
          <TopBar
            studioLabel="Studio"
            studioId={studioId}
            menuOpen={chrome.drawerOpen}
            onMenu={() => chrome.openDrawer("nav")}
            onSettings={() => chrome.openDrawer("settings")}
          />
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
        <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId={studioId} initialPanel={chrome.drawerPanel} />
      </div>
    )
  }

  const card = studiosQuery.data.studios.find((s) => s.id === studioId)
  const Viewer = viewerLoaders[studioId]
  const page = Viewer ? <Viewer key={studioId} /> : <p className="p-8 text-sm">Unknown studio</p>
  const label = card?.label ?? studioId
  const nativeAvailable = studiosQuery.data.nativeOpenCodeAvailable
  const workspace = studiosQuery.data.workspace

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
          onMenu={() => chrome.openDrawer("nav")}
          onSettings={() => chrome.openDrawer("settings")}
          edge="flush"
          actions={
            <AgentChromeActions
              agentOpen={chrome.agentOpen}
              agentStatusLabel={chrome.agentStatusLabel}
              agentStatusDotClass={chrome.agentStatusDotClass}
              onToggle={chrome.toggleAgent}
            />
          }
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <NativeAgentFrame
            workspace={workspace}
            available={nativeAvailable}
            open={chrome.agentOpen}
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
                {page}
              </ViewerRouteBoundary>
            </Suspense>
          </main>
        </div>
      </div>
      <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId={studioId} initialPanel={chrome.drawerPanel} />
    </div>
  )
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="absolute top-0 left-3 z-[100] -translate-y-full rounded-[var(--osc-radius-md)] bg-[var(--osc-primary)] px-3 py-2 text-[12px] font-medium text-[var(--osc-primary-fg)] shadow-[var(--osc-shadow)] transition-transform duration-[var(--osc-motion-duration)] focus:translate-y-3 focus:outline-none focus-visible:shadow-[var(--osc-focus-ring)]"
    >
      Skip to main content
    </a>
  )
}

function FilesFrame() {
  const chrome = useStudioChrome()

  return (
    <div data-studio="files" className="studio-shell flex min-h-dvh flex-col bg-[var(--osc-bg)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={chrome.drawerOpen ? true : undefined}>
        <TopBar
          studioLabel="Files"
          studioId="files"
          menuOpen={chrome.drawerOpen}
          onMenu={() => chrome.openDrawer("nav")}
          onSettings={() => chrome.openDrawer("settings")}
          edge="flush"
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <main id="main-content" data-testid="studio-main" className="flex min-h-0 min-w-0 flex-1 flex-col" tabIndex={-1}>
            <FilesExplorer />
          </main>
        </div>
      </div>
      <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId="files" initialPanel={chrome.drawerPanel} />
    </div>
  )
}

export function App() {
  const location = useLocation()

  useEffect(() => {
    const title = location.pathname.startsWith("/files")
      ? "Files"
      : location.pathname.startsWith("/studios/cad")
        ? "CAD"
        : location.pathname.startsWith("/studios/pcb")
          ? "PCB"
          : "OpenCode"
    document.title = `${title} · OpenCode Studio`
  }, [location.pathname])

  return (
    <>
      <SkipLink />
      <Routes>
        <Route path="/" element={<OpenCodeFrame />} />
        <Route path="/files/*" element={<FilesFrame />} />
        <Route path="/studios/:studioId/*" element={<StudioFrame />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
