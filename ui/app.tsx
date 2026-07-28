import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useParams } from "react-router"
import { isStudioId, STUDIO_IDS, type StudioId } from "../src/core/registry"
import { Badge } from "./components/badge"
import { Button } from "./components/button"
import { EmptyState } from "./components/empty-state"
import { ErrorState } from "./components/error-state"
import { FilesExplorer } from "./files-explorer"
import { fetchJson } from "./lib/fetch-json"
import { useFocusTrap } from "./lib/focus-trap"
import { NativeAgentFrame } from "./native-agent-frame"
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

function checkTone(status: HostCheck["status"] | "unknown"): "ok" | "warn" | "fail" | "neutral" {
  if (status === "pass") return "ok"
  if (status === "warn") return "warn"
  if (status === "fail") return "fail"
  return "neutral"
}

function skillBadgeLabel(status: HostCheck["status"] | "unknown", message?: string) {
  if (status === "pass") return "ok"
  if (status === "warn") return "drift"
  if (status === "unknown") return "…"
  const text = (message ?? "").toLowerCase()
  if (text.includes("user-modified")) return "modified"
  if (text.includes("unmarked")) return "unmarked"
  if (text.includes("missing")) return "missing"
  return "fail"
}

function engineBadgeLabel(status: HostCheck["status"] | "unknown") {
  if (status === "pass") return "ok"
  if (status === "warn") return "warn"
  if (status === "fail") return "missing"
  return "…"
}

function StudioHealthBadges({ studio, checks }: { studio: StudioCard; checks: HostCheck[] }) {
  const skillCheck = checks.find((check) => check.id === `skill:${studio.id}`)
  const skillStatus = skillCheck?.status ?? (studio.skillInstalled ? "pass" : "fail")
  const skillMessage = skillCheck?.message ?? (studio.skillInstalled ? "Skill installed" : "Skill missing")
  const engines = studio.requiredEngines.map((engine) => {
    const check = checks.find((item) => item.id === `engine:${studio.id}:${engine}`)
    return { engine, status: check?.status ?? ("unknown" as const), message: check?.message }
  })
  const rootBad = Boolean(studio.rootError)

  return (
    <div className="mb-5 flex flex-wrap gap-1.5">
      <span className="sr-only">{studio.label} readiness</span>
      <Badge tone={checkTone(skillStatus)} title={skillMessage}>
        skill {skillBadgeLabel(skillStatus, skillMessage)}
      </Badge>
      {engines.map(({ engine, status, message }) => (
        <Badge key={engine} tone={checkTone(status)} title={message ?? engine}>
          {engine} {engineBadgeLabel(status)}
        </Badge>
      ))}
      {rootBad && (
        <Badge tone="fail" title={studio.rootError}>
          root error
        </Badge>
      )}
    </div>
  )
}

const STUDIO_META: Record<string, { short: string; blurb: string }> = {
  cad: { short: "CAD", blurb: "Parts, assemblies, renders" },
  pcb: { short: "PCB", blurb: "Schematic, layout, BOM" },
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
    <section className="osc-drawer-section" aria-labelledby="osc-appearance-label">
      <h2 id="osc-appearance-label" className="osc-drawer-label">
        Appearance
      </h2>
      <p className="osc-drawer-help">Follows your device unless you pick Light or Dark.</p>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Theme</legend>
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
      </fieldset>
    </section>
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(19.5rem,100vw)] max-w-full flex-col overscroll-contain border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow-md)] transition-transform duration-[var(--osc-motion-duration)] ease-[var(--osc-motion-ease)] sm:w-[min(19.5rem,92vw)] ${
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
              <button key={id} type="button" role="tab" aria-selected={panel === id} onClick={() => setPanel(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === "nav" && (
            <nav className="flex flex-col gap-4 p-2 pb-4" aria-label="Studios">
              <div className="flex flex-col gap-0.5">
                <p className="osc-drawer-label px-2.5 pt-1.5 pb-1">Workspace</p>
                <DrawerNavLink to="/" active={!studioId} onNavigate={onClose} title="Home" blurb="Studio hub" />
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
            <div className="flex min-h-full flex-col">
              <div className="flex flex-1 flex-col">
                <ThemePreferenceControl />

                <section className="osc-drawer-section" aria-labelledby="osc-studios-label">
                  <h2 id="osc-studios-label" className="osc-drawer-label">
                    Studios
                  </h2>
                  <p className="osc-drawer-help">CAD and PCB stay on. Open a studio from Navigate or Home.</p>

                  {csrfQuery.isError && (
                    <p
                      className="rounded-[var(--osc-radius-md)] border border-[var(--osc-error)]/40 bg-[var(--osc-error-bg)] px-3 py-2 text-[12px] text-[var(--osc-error)]"
                      role="alert"
                    >
                      CSRF unavailable — cannot repair install.
                    </p>
                  )}
                  {studiosQuery.data?.configError && (
                    <p
                      className="rounded-[var(--osc-radius-md)] border border-[var(--osc-error)]/40 bg-[var(--osc-error-bg)] px-3 py-2 text-[12px] text-[var(--osc-error)]"
                      role="alert"
                    >
                      Config error: {studiosQuery.data.configError}
                    </p>
                  )}

                  <ul className="osc-drawer-list">
                    {cards.map((studio) => {
                      const meta = STUDIO_META[studio.id]
                      return (
                        <li key={studio.id}>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ background: `var(--osc-accent-${studio.id})` }}
                                aria-hidden
                              />
                              <span className="truncate text-[13px] font-medium text-[var(--osc-text)]">{studio.label}</span>
                            </span>
                            {meta?.blurb ? (
                              <span className="truncate pl-4 text-[11px] text-[var(--osc-text-faint)]">{meta.blurb}</span>
                            ) : null}
                          </span>
                          <Badge tone="neutral" className="shrink-0">
                            on
                          </Badge>
                        </li>
                      )
                    })}
                  </ul>
                </section>

                {(repair.isSuccess || repair.isError) && (
                  <section className="osc-drawer-section">
                    {repair.isSuccess && (
                      <div
                        className="rounded-[var(--osc-radius-md)] border border-[var(--osc-warning)]/30 bg-[var(--osc-warning-bg)] px-3 py-2.5 text-[12px]"
                        role="status"
                      >
                        <p className="font-medium text-[var(--osc-warning)]">Install repaired</p>
                        <p className="mt-1 text-[var(--osc-text-muted)]">
                          {studiosQuery.data?.restartRequiredHint ?? "Restart OpenCode so plugins and skills match."}
                        </p>
                      </div>
                    )}
                    {repair.isError && (
                      <p
                        className="rounded-[var(--osc-radius-md)] border border-[var(--osc-error)]/40 bg-[var(--osc-error-bg)] px-3 py-2 text-[12px] text-[var(--osc-error)]"
                        role="alert"
                      >
                        {(repair.error as Error).message}
                      </p>
                    )}
                  </section>
                )}

                {studiosQuery.data && (
                  <section className="osc-drawer-section" aria-labelledby="osc-install-label">
                    <h2 id="osc-install-label" className="osc-drawer-label">
                      Install
                    </h2>
                    <div className="osc-drawer-meta">
                      <p>v{studiosQuery.data.packageVersion}</p>
                      <p title={studiosQuery.data.workspace}>workspace · {studiosQuery.data.workspace}</p>
                      {studiosQuery.data.configPath && <p title={studiosQuery.data.configPath}>config · {studiosQuery.data.configPath}</p>}
                    </div>
                    {cards.length > 0 && (
                      <div className="flex flex-col gap-2">
                        {cards.map((s) => (
                          <details
                            key={s.id}
                            className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg)] px-3 py-2"
                          >
                            <summary className="cursor-pointer text-[12px] font-medium text-[var(--osc-text)]">{s.label} paths</summary>
                            <dl className="mt-2 space-y-1 font-mono text-[10px] text-[var(--osc-text-faint)]">
                              <div>
                                <dt className="inline text-[var(--osc-text-muted)]">root </dt>
                                <dd className="inline break-all">{s.root ?? s.rootError ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="inline text-[var(--osc-text-muted)]">skill </dt>
                                <dd className="inline">{s.skillInstalled ? s.skill : `${s.skill} (not installed)`}</dd>
                              </div>
                              <div>
                                <dt className="inline text-[var(--osc-text-muted)]">engines </dt>
                                <dd className="inline">{s.requiredEngines.join(", ") || "none"}</dd>
                              </div>
                            </dl>
                          </details>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>

              <div className="osc-drawer-footer">
                <p className="mb-2 text-center text-[11px] text-[var(--osc-text-faint)]">Reinstalls managed plugins and skills</p>
                <Button type="button" className="w-full" disabled={repair.isPending || !csrfQuery.data} onClick={() => repair.mutate()}>
                  {repair.isPending ? "Repairing…" : "Repair install"}
                </Button>
              </div>
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

function HomePage() {
  const studiosQuery = useStudios()
  const chrome = useStudioChrome()
  const cards = studiosQuery.data?.studios ?? []

  return (
    <div className="min-h-dvh bg-[var(--osc-bg)]">
      <div inert={chrome.drawerOpen ? true : undefined}>
        <TopBar
          menuOpen={chrome.drawerOpen}
          onMenu={() => chrome.openDrawer("nav")}
          onSettings={() => chrome.openDrawer("settings")}
          actions={
            studiosQuery.data?.nativeOpenCodeAvailable ? (
              <a href="/" className="osc-chip" title="Open OpenCode" aria-label="OpenCode">
                <span className="hidden min-[480px]:inline">OpenCode</span>
                <span className="min-[480px]:hidden" aria-hidden="true">
                  OC
                </span>
              </a>
            ) : undefined
          }
        />

        <main id="main-content" className="mx-auto max-w-[820px] px-5 py-10 sm:px-8 sm:py-16 md:py-20">
          <div className="osc-reveal mb-8 sm:mb-12">
            <p className="mb-2.5 text-[11px] font-medium tracking-[0.16em] text-[var(--osc-text-faint)] uppercase sm:mb-3">Companion</p>
            <h1 className="text-[2rem] leading-[1.12] font-semibold tracking-[-0.03em] text-pretty text-[var(--osc-text)] sm:text-[2.5rem]">
              Studios
            </h1>
            <p className="mt-2.5 max-w-md text-[14px] leading-relaxed text-[var(--osc-text-muted)] sm:mt-3 sm:text-[15px]">
              Open CAD or PCB. Design with the Agent — viewers update as artifacts land in the workspace.
            </p>
          </div>

          {studiosQuery.isLoading && (
            <div className="grid gap-3 sm:grid-cols-2" role="status" aria-busy="true">
              <span className="sr-only">Loading studios…</span>
              <div className="osc-skeleton h-48" aria-hidden />
              <div className="osc-skeleton h-48" aria-hidden />
            </div>
          )}
          {studiosQuery.isError && (
            <ErrorState
              title="Failed to load studios"
              description={(studiosQuery.error as Error)?.message ?? "unknown error"}
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => void studiosQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          )}

          {studiosQuery.data?.update?.updateAvailable && (
            <div
              className="mb-8 rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-4 py-3.5 shadow-[var(--osc-shadow)] sm:mb-10 sm:px-5 sm:py-4"
              role="status"
            >
              <p className="text-[13px] font-medium sm:text-sm">
                Update available · v{studiosQuery.data.update.current} → v{studiosQuery.data.update.latest}
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[var(--osc-radius-md)] bg-[var(--osc-bg-subtle)] px-3 py-2 font-mono text-[11px] text-[var(--osc-text-muted)]">
                {`opencode-studio upgrade`}
              </pre>
            </div>
          )}

          {studiosQuery.isSuccess && cards.length === 0 && (
            <EmptyState
              title="No studios available"
              description="Repair the install from Settings if plugins or skills are missing, then restart OpenCode."
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => chrome.openDrawer("settings")}>
                  Open settings
                </Button>
              }
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((studio, index) => {
              const meta = STUDIO_META[studio.id]
              return (
                <Link
                  key={studio.id}
                  to={`/studios/${studio.id}`}
                  data-studio={studio.id}
                  className="osc-reveal osc-home-card group"
                  style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
                >
                  <span className="osc-home-card__rail" style={{ background: `var(--osc-accent-${studio.id})` }} aria-hidden />
                  <div className="mb-3 flex items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: `var(--osc-accent-${studio.id})` }} aria-hidden />
                    <h2 className="text-[15px] font-semibold tracking-tight">{studio.label}</h2>
                  </div>
                  <p className="mb-1.5 text-[12px] text-[var(--osc-text-faint)]">{meta?.blurb}</p>
                  <p className="mb-4 flex-1 text-[13px] leading-relaxed text-[var(--osc-text-muted)]">{studio.description}</p>
                  <StudioHealthBadges studio={studio} checks={studiosQuery.data?.checks ?? []} />
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--osc-text)]">
                    Open {meta?.short ?? studio.label}
                    <span
                      className="text-[var(--osc-text-faint)] transition-transform duration-[var(--osc-motion-duration)] group-hover:translate-x-0.5"
                      aria-hidden
                    >
                      →
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
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

function AgentChromeActions({
  nativeAvailable,
  agentOpen,
  agentStatusLabel: statusLabel,
  agentStatusDotClass: statusDot,
  onToggle,
}: {
  nativeAvailable: boolean
  agentOpen: boolean
  agentStatusLabel: string
  agentStatusDotClass: string
  onToggle: () => void
}) {
  return (
    <>
      {nativeAvailable && (
        <a href="/" className="osc-chip" title="Open OpenCode" aria-label="OpenCode">
          <span className="hidden min-[480px]:inline">OpenCode</span>
          <span className="min-[480px]:hidden" aria-hidden="true">
            OC
          </span>
        </a>
      )}
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
    </>
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
        <TopBar
          studioLabel="Loading…"
          menuOpen={chrome.drawerOpen}
          onMenu={() => chrome.openDrawer("nav")}
          onSettings={() => chrome.openDrawer("settings")}
        />
        <div className="flex flex-1 flex-col gap-3 p-4 sm:p-6" role="status" aria-busy="true">
          <span className="sr-only">Loading studio…</span>
          <div className="osc-skeleton h-10 w-full max-w-md" aria-hidden />
          <div className="osc-skeleton min-h-48 flex-1" aria-hidden />
        </div>
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
              nativeAvailable={nativeAvailable}
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
          <div id="main-content" data-testid="studio-main" className="flex min-h-0 min-w-0 flex-1 flex-col" tabIndex={-1}>
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--osc-text-muted)]">Loading studio…</div>
              }
            >
              {page}
            </Suspense>
          </div>
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
  const studiosQuery = useStudios()
  const chrome = useStudioChrome()
  const nativeAvailable = studiosQuery.data?.nativeOpenCodeAvailable ?? false
  const workspace = studiosQuery.data?.workspace ?? ""

  return (
    <div
      data-studio="files"
      data-agent-open={chrome.agentOpen ? "true" : "false"}
      className="studio-shell flex min-h-dvh flex-col bg-[var(--osc-bg)]"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={chrome.drawerOpen ? true : undefined}>
        <TopBar
          studioLabel="Files"
          studioId="files"
          menuOpen={chrome.drawerOpen}
          onMenu={() => chrome.openDrawer("nav")}
          onSettings={() => chrome.openDrawer("settings")}
          edge="flush"
          actions={
            <AgentChromeActions
              nativeAvailable={nativeAvailable}
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
          <div id="main-content" data-testid="studio-main" className="flex min-h-0 min-w-0 flex-1 flex-col" tabIndex={-1}>
            <FilesExplorer />
          </div>
        </div>
      </div>
      <SideDrawer open={chrome.drawerOpen} onClose={chrome.closeDrawer} studioId="files" initialPanel={chrome.drawerPanel} />
    </div>
  )
}

export function App() {
  return (
    <>
      <SkipLink />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/files/*" element={<FilesFrame />} />
        <Route path="/studios/:studioId/*" element={<StudioFrame />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
