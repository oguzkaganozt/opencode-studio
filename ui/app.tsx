import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useParams } from "react-router"
import { isStudioId, STUDIO_IDS, type StudioId } from "../src/core/registry"
import { Badge } from "./components/badge"
import { Button } from "./components/button"
import { FilesExplorer } from "./files-explorer"
import { NativeAgentFrame } from "./native-agent-frame"
import { clearStudioRuntime, setStudioRuntime } from "./studio-context"
import { readThemePreference, setThemePreference, type ThemePreference } from "./theme"
import { useStudioChrome } from "./use-studio-chrome"

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ?? body?.error ?? `Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
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
    <div>
      <h2 className="text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Appearance</h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">Follows your device unless you pick Light or Dark.</p>
      <fieldset className="mt-2 m-0 min-w-0 rounded-lg border border-[var(--osc-border)] p-1">
        <legend className="sr-only">Theme</legend>
        <div className="flex gap-1">
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
              className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${
                preference === value
                  ? "bg-[var(--osc-surface)] text-[var(--osc-text)] shadow-[var(--osc-shadow)]"
                  : "text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]"
              }`}
              aria-pressed={preference === value}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
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
  initialPanel?: "nav" | "settings"
}) {
  const titleId = useId()
  const asideRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const studiosQuery = useStudios()
  const csrfQuery = useCsrf()
  const repair = useRepairInstall()
  const [panel, setPanel] = useState<"nav" | "settings">(initialPanel)

  useEffect(() => {
    if (open) setPanel(initialPanel)
  }, [open, initialPanel])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const t = window.setTimeout(() => closeRef.current?.focus(), 0)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }
      if (e.key !== "Tab" || !asideRef.current) return
      const nodes = [
        ...asideRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1)
      if (nodes.length === 0) return
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prevOverflow
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  const cards = studiosQuery.data?.studios ?? []

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-[var(--osc-overlay)] backdrop-blur-[2px] transition-opacity duration-[var(--osc-motion-duration)] ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!open}
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(19.5rem,92vw)] flex-col border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[0_0_0_1px_rgba(0,0,0,0.02),8px_0_40px_rgba(0,0,0,0.08)] transition-transform duration-[var(--osc-motion-duration)] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? "translate-x-0" : "pointer-events-none -translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        inert={open ? undefined : true}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--osc-border)] px-3">
          <div className="flex items-center gap-2.5 px-1">
            <span className="grid size-7 place-items-center rounded-md bg-[var(--osc-primary)] text-[10px] font-semibold tracking-tight text-[var(--osc-primary-fg)]">
              os
            </span>
            <span id={titleId} className="text-[13px] font-semibold tracking-tight">
              opencode<span className="font-normal text-[var(--osc-text-muted)]"> studio</span>
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md text-[var(--osc-text-muted)] transition-colors hover:bg-[var(--osc-surface)] hover:text-[var(--osc-text)]"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex gap-1 border-b border-[var(--osc-border)] p-1.5">
          {(
            [
              ["nav", "Studios"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPanel(id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${
                panel === id
                  ? "bg-[var(--osc-surface)] text-[var(--osc-text)] shadow-[var(--osc-shadow)]"
                  : "text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === "nav" && (
            <nav className="flex flex-col gap-0.5 p-2" aria-label="Studios">
              <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">
                Navigate
              </p>
              <Link
                to="/"
                onClick={onClose}
                className={`rounded-lg px-3 py-2.5 text-[13px] transition-colors ${
                  !studioId
                    ? "bg-[var(--osc-surface)] font-medium text-[var(--osc-text)]"
                    : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
              >
                Home
              </Link>
              <Link
                to="/files"
                onClick={onClose}
                className={`rounded-lg px-3 py-2.5 text-[13px] transition-colors ${
                  studioId === "files"
                    ? "bg-[var(--osc-surface)] font-medium text-[var(--osc-text)]"
                    : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
              >
                Files
              </Link>
              {cards.map((s) => {
                const active = s.id === studioId
                const meta = STUDIO_META[s.id]
                return (
                  <Link
                    key={s.id}
                    to={`/studios/${s.id}`}
                    onClick={onClose}
                    className={`relative rounded-lg px-3 py-2.5 transition-colors ${
                      active
                        ? "bg-[var(--osc-surface)] text-[var(--osc-text)]"
                        : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full"
                        style={{ background: `var(--osc-accent-${s.id})` }}
                        aria-hidden
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full" style={{ background: `var(--osc-accent-${s.id})` }} aria-hidden />
                      <span className="text-[13px] font-medium">{s.label}</span>
                    </div>
                    <p className="mt-0.5 pl-3.5 text-[11px] text-[var(--osc-text-faint)]">{meta?.blurb}</p>
                  </Link>
                )
              })}
            </nav>
          )}

          {panel === "settings" && (
            <div className="flex min-h-full flex-col">
              <div className="flex flex-1 flex-col gap-4 p-4">
                <div>
                  <h2 className="text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Studios</h2>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">
                    CAD and PCB are always on. Repair reinstalls plugins and skills if something is missing.
                  </p>
                </div>

                {csrfQuery.isError && (
                  <p
                    className="rounded-lg border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-3 py-2 text-[12px] text-[var(--osc-error)]"
                    role="alert"
                  >
                    CSRF unavailable — cannot repair install.
                  </p>
                )}
                {studiosQuery.data?.configError && (
                  <p className="rounded-lg border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-3 py-2 text-[12px]" role="alert">
                    Config error: {studiosQuery.data.configError}
                  </p>
                )}

                <ul className="divide-y divide-[var(--osc-border)] overflow-hidden rounded-lg border border-[var(--osc-border)]">
                  {cards.map((studio) => (
                    <li key={studio.id} className="flex items-center justify-between gap-3 bg-[var(--osc-bg-elevated)] px-3 py-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: `var(--osc-accent-${studio.id})` }}
                          aria-hidden
                        />
                        <span className="truncate text-[13px] font-medium">{studio.label}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--osc-text-faint)]">always on</span>
                    </li>
                  ))}
                </ul>

                <ThemePreferenceControl />

                {repair.isSuccess && (
                  <div
                    className="rounded-lg border border-[var(--osc-warning)]/30 bg-[var(--osc-warning-bg)] px-3 py-2.5 text-[12px]"
                    role="status"
                  >
                    <p className="font-medium text-[var(--osc-warning)]">Install repaired</p>
                    <p className="mt-1 text-[var(--osc-text-muted)]">
                      {studiosQuery.data?.restartRequiredHint ?? "Restart OpenCode so plugins and skills match."}
                    </p>
                  </div>
                )}
                {repair.isError && (
                  <p className="text-[12px] text-[var(--osc-error)]" role="alert">
                    {(repair.error as Error).message}
                  </p>
                )}

                {studiosQuery.data && (
                  <div className="space-y-1.5 border-t border-[var(--osc-border)] pt-4 font-mono text-[10px] leading-relaxed text-[var(--osc-text-faint)]">
                    <p>v{studiosQuery.data.packageVersion}</p>
                    <p className="break-all" title={studiosQuery.data.workspace}>
                      {studiosQuery.data.workspace}
                    </p>
                    {studiosQuery.data.configPath && (
                      <p className="break-all" title={studiosQuery.data.configPath}>
                        {studiosQuery.data.configPath}
                      </p>
                    )}
                  </div>
                )}

                {cards.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Details</p>
                    {cards.map((s) => (
                      <details key={s.id} className="rounded-lg border border-[var(--osc-border)] px-3 py-2">
                        <summary className="cursor-pointer text-[12px] font-medium text-[var(--osc-text)]">{s.label}</summary>
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
              </div>

              <div className="sticky bottom-0 border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3">
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
  onMenu,
  edge = "border",
  actions,
}: {
  studioLabel?: string
  studioId?: string
  onMenu: () => void
  /** studio pages stack a subnav — drop the bottom border to avoid a double line */
  edge?: "border" | "flush"
  actions?: React.ReactNode
}) {
  return (
    <header
      className={`sticky top-0 z-40 shrink-0 bg-[var(--osc-bg-elevated)]/90 backdrop-blur-md ${
        edge === "border" ? "border-b border-[var(--osc-border)]" : ""
      }`}
    >
      <div className="flex h-12 items-center gap-2.5 px-2 sm:px-3">
        <button
          type="button"
          onClick={onMenu}
          className="grid size-9 place-items-center rounded-md text-[var(--osc-text)] transition-colors hover:bg-[var(--osc-surface)]"
          aria-label="Open menu"
        >
          <MenuIcon />
        </button>
        {studioLabel ? (
          <div className="flex min-w-0 items-center gap-2">
            {studioId && (
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--osc-accent-${studioId})` }} aria-hidden />
            )}
            <p className="truncate text-[14px] font-semibold tracking-tight text-[var(--osc-text)]">{studioLabel}</p>
          </div>
        ) : (
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-[var(--osc-surface)]">
            <span className="grid size-7 place-items-center rounded-md bg-[var(--osc-primary)] text-[10px] font-semibold tracking-tight text-[var(--osc-primary-fg)]">
              os
            </span>
            <span className="truncate text-[13px] font-semibold tracking-tight">
              opencode<span className="font-normal text-[var(--osc-text-muted)]"> studio</span>
            </span>
          </Link>
        )}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

function HomePage() {
  const studiosQuery = useStudios()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerPanel, setDrawerPanel] = useState<"nav" | "settings">("nav")

  const openMenu = () => {
    setDrawerPanel("nav")
    setDrawerOpen(true)
  }

  const cards = studiosQuery.data?.studios ?? []

  return (
    <div className="min-h-dvh bg-[var(--osc-bg)]">
      <TopBar
        onMenu={openMenu}
        actions={
          studiosQuery.data?.nativeOpenCodeAvailable ? (
            <a
              href="/"
              className="inline-flex h-8 items-center rounded-md border border-[var(--osc-border)] px-2.5 text-[11px] font-medium hover:bg-[var(--osc-surface)]"
            >
              OpenCode
            </a>
          ) : undefined
        }
      />
      <SideDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} initialPanel={drawerPanel} />

      <main id="main-content" className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
        <div className="osc-reveal mb-12">
          <p className="mb-3 text-[11px] font-medium tracking-[0.16em] text-[var(--osc-text-faint)] uppercase">Companion</p>
          <h1 className="text-[2.15rem] leading-[1.1] font-semibold tracking-[-0.04em] text-[var(--osc-text)] sm:text-[2.5rem]">Studios</h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--osc-text-muted)]">
            Open CAD or PCB. Design with the Agent — viewers update as artifacts land in the workspace.
          </p>
        </div>

        {studiosQuery.isLoading && <p className="text-sm text-[var(--osc-text-muted)]">Loading studios…</p>}
        {studiosQuery.isError && (
          <p
            className="rounded-lg border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-4 py-3 text-sm text-[var(--osc-error)]"
            role="alert"
          >
            Failed to load studios: {(studiosQuery.error as Error)?.message ?? "unknown error"}
          </p>
        )}

        {studiosQuery.data?.update?.updateAvailable && (
          <div
            className="mb-10 rounded-xl border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-5 py-4 shadow-[var(--osc-shadow)]"
            role="status"
          >
            <p className="text-sm font-medium">
              Update available · v{studiosQuery.data.update.current} → v{studiosQuery.data.update.latest}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--osc-bg-subtle)] px-3 py-2 font-mono text-[11px] text-[var(--osc-text-muted)]">
              {`opencode-studio upgrade`}
            </pre>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((studio, index) => {
            const meta = STUDIO_META[studio.id]
            return (
              <Link
                key={studio.id}
                to={`/studios/${studio.id}`}
                data-studio={studio.id}
                className="osc-reveal group relative flex flex-col overflow-hidden rounded-xl border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-6 shadow-[var(--osc-shadow)] transition-[border-color,box-shadow,transform] duration-[var(--osc-motion-duration)] hover:-translate-y-0.5 hover:border-[var(--osc-border-strong)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
                style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
              >
                <span
                  className="absolute inset-y-0 left-0 w-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: `var(--osc-accent-${studio.id})` }}
                  aria-hidden
                />
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
        <a
          href="/"
          className="inline-flex h-8 items-center rounded-md border border-[var(--osc-border)] px-2.5 text-[11px] font-medium hover:bg-[var(--osc-surface)]"
        >
          OpenCode
        </a>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--osc-border)] px-2.5 text-[11px] font-medium hover:bg-[var(--osc-surface)]"
        aria-pressed={agentOpen}
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

  if (studioId) {
    setStudioRuntime({ studioId, uiBase: uiBasePath, apiBase: apiBasePath })
  }

  useEffect(() => {
    if (!studioId) return
    setStudioRuntime({ studioId, uiBase: uiBasePath, apiBase: apiBasePath })
    return () => {
      clearStudioRuntime()
    }
  }, [studioId, uiBasePath, apiBasePath])

  if (studiosQuery.isLoading) {
    return (
      <div className="flex min-h-dvh flex-col bg-[var(--osc-bg)]">
        <TopBar studioLabel="Loading…" onMenu={() => chrome.setDrawerOpen(true)} />
        <p className="p-8 text-sm text-[var(--osc-text-muted)]">Loading…</p>
      </div>
    )
  }
  if (!isStudioId(studioId)) {
    return <Navigate to="/" replace />
  }
  if (studiosQuery.isError || !studiosQuery.data) {
    return (
      <div className="flex min-h-dvh flex-col bg-[var(--osc-bg)]">
        <TopBar studioLabel="Studio" studioId={studioId} onMenu={() => chrome.setDrawerOpen(true)} />
        <SideDrawer open={chrome.drawerOpen} onClose={() => chrome.setDrawerOpen(false)} studioId={studioId} initialPanel="nav" />
        <p className="p-8 text-sm text-[var(--osc-error)]" role="alert">
          Failed to load studio host: {(studiosQuery.error as Error)?.message ?? "unknown error"}
        </p>
      </div>
    )
  }

  const card = studiosQuery.data.studios.find((s) => s.id === studioId)
  const Viewer = viewerLoaders[studioId]
  const page = Viewer ? <Viewer /> : <p className="p-8 text-sm">Unknown studio</p>
  const label = card?.label ?? studioId
  const nativeAvailable = studiosQuery.data.nativeOpenCodeAvailable
  const workspace = studiosQuery.data.workspace

  return (
    <div data-studio={studioId} className="studio-shell flex min-h-dvh flex-col bg-[var(--osc-bg)]">
      <TopBar
        studioLabel={label}
        studioId={studioId}
        onMenu={() => chrome.setDrawerOpen(true)}
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
      <SideDrawer open={chrome.drawerOpen} onClose={() => chrome.setDrawerOpen(false)} studioId={studioId} initialPanel="nav" />
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
  )
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="absolute top-0 left-3 z-[100] -translate-y-full rounded-md bg-[var(--osc-primary)] px-3 py-2 text-[12px] font-medium text-[var(--osc-primary-fg)] shadow-[var(--osc-shadow)] transition-transform focus:translate-y-3 focus:outline-none"
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
    <div data-studio="files" className="studio-shell flex min-h-dvh flex-col bg-[var(--osc-bg)]">
      <TopBar
        studioLabel="Files"
        studioId="files"
        onMenu={() => chrome.setDrawerOpen(true)}
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
      <SideDrawer open={chrome.drawerOpen} onClose={() => chrome.setDrawerOpen(false)} studioId="files" initialPanel="nav" />
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
