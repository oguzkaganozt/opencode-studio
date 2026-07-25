import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useParams } from "react-router"
import { isStudioId, STUDIO_IDS, type StudioId } from "../src/core/registry"
import { clearStudioRuntime, setStudioRuntime } from "./studio-context"

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
  restartRequiredHint: string
  update?: UpdateInfo
}

const STUDIO_META: Record<string, { short: string; blurb: string }> = {
  cad: { short: "CAD", blurb: "Parts, assemblies, renders" },
  media: { short: "Media", blurb: "Library browse & preview" },
  pcb: { short: "PCB", blurb: "Schematic, layout, BOM" },
  startup: { short: "Startup", blurb: "Idea pool & evidence" },
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

function useConfigure() {
  const queryClient = useQueryClient()
  const csrfQuery = useCsrf()
  return useMutation({
    mutationFn: async (next: string[]) => {
      const token = csrfQuery.data?.token
      if (!token) throw new Error("CSRF token unavailable")
      return fetchJson<{ message?: string; restartRequired?: boolean }>("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
        },
        body: JSON.stringify({ enabled: next }),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["host"] })
    },
  })
}

/** Survives drawer unmount across routes so toggles aren't lost mid-edit. */
let enablementDraft: string[] | null = null

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
  const configure = useConfigure()
  const [panel, setPanel] = useState<"nav" | "settings">(initialPanel)
  const [selected, setSelected] = useState<string[] | null>(() => enablementDraft)

  useEffect(() => {
    if (open) setPanel(initialPanel)
  }, [open, initialPanel])

  useEffect(() => {
    enablementDraft = selected
  }, [selected])

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
  const saved = studiosQuery.data?.enabled ?? []
  const enabledIds = selected ?? saved
  const enabledCards = cards.filter((s) => saved.includes(s.id))
  const dirty =
    selected !== null &&
    (selected.length !== saved.length || selected.some((id) => !saved.includes(id)) || saved.some((id) => !selected.includes(id)))

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-zinc-900/20 backdrop-blur-[2px] transition-opacity duration-[var(--osc-motion-duration)] ${
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
            <nav className="flex flex-col gap-0.5 p-2" aria-label="Enabled studios">
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
              {enabledCards.length === 0 ? (
                <p className="px-3 py-8 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">
                  No studios enabled. Open Settings to turn some on.
                </p>
              ) : (
                enabledCards.map((s) => {
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
                })
              )}
            </nav>
          )}

          {panel === "settings" && (
            <div className="flex min-h-full flex-col">
              <div className="flex flex-1 flex-col gap-4 p-4">
                <div>
                  <h2 className="text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Enable studios</h2>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">
                    Apply writes your user config. Restart OpenCode so plugins match.
                  </p>
                </div>

                {csrfQuery.isError && (
                  <p
                    className="rounded-lg border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-3 py-2 text-[12px] text-[var(--osc-error)]"
                    role="alert"
                  >
                    CSRF unavailable — cannot save config.
                  </p>
                )}
                {studiosQuery.data?.configError && (
                  <p className="rounded-lg border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-3 py-2 text-[12px]" role="alert">
                    Config error: {studiosQuery.data.configError}
                  </p>
                )}

                <ul className="divide-y divide-[var(--osc-border)] overflow-hidden rounded-lg border border-[var(--osc-border)]">
                  {cards.map((studio) => {
                    const on = enabledIds.includes(studio.id)
                    return (
                      <li key={studio.id}>
                        <label className="flex cursor-pointer items-center justify-between gap-3 bg-[var(--osc-bg-elevated)] px-3 py-3 transition-colors hover:bg-[var(--osc-surface)]">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ background: on ? `var(--osc-accent-${studio.id})` : "var(--osc-border-strong)" }}
                              aria-hidden
                            />
                            <span className="truncate text-[13px] font-medium">{studio.label}</span>
                          </span>
                          <span className="relative inline-flex shrink-0 items-center">
                            <span className="sr-only">{on ? "enabled" : "disabled"}</span>
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={on}
                              onChange={() => {
                                configure.reset()
                                setSelected((current) => {
                                  const base = current ?? saved
                                  return on ? base.filter((id) => id !== studio.id) : [...base, studio.id]
                                })
                              }}
                            />
                            <span className="h-5 w-9 rounded-full bg-[var(--osc-border-strong)] transition-colors peer-checked:bg-[var(--osc-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--osc-text)] peer-focus-visible:ring-offset-2" />
                            <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>

                {dirty && <p className="text-[12px] text-[var(--osc-text-muted)]">Unsaved changes</p>}
                {configure.isSuccess && (
                  <div
                    className="rounded-lg border border-[var(--osc-warning)]/30 bg-[var(--osc-warning-bg)] px-3 py-2.5 text-[12px]"
                    role="status"
                  >
                    <p className="font-medium text-[var(--osc-warning)]">Configuration saved</p>
                    <p className="mt-1 text-[var(--osc-text-muted)]">
                      {studiosQuery.data?.restartRequiredHint ?? "Host APIs reloaded. Restart OpenCode so plugins and skills match."}
                    </p>
                  </div>
                )}
                {configure.isError && (
                  <p className="text-[12px] text-[var(--osc-error)]" role="alert">
                    {(configure.error as Error).message}
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

                {cards.some((s) => saved.includes(s.id)) && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Details</p>
                    {cards.map((s) =>
                      saved.includes(s.id) ? (
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
                      ) : null,
                    )}
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3">
                <button
                  type="button"
                  disabled={configure.isPending || !csrfQuery.data || !dirty}
                  onClick={() => {
                    configure.mutate(enabledIds, {
                      onSuccess: () => {
                        setSelected(null)
                        enablementDraft = null
                      },
                    })
                  }}
                  className="inline-flex h-9 w-full items-center justify-center rounded-full bg-[var(--osc-primary)] px-4 text-[12px] font-medium text-[var(--osc-primary-fg)] transition-colors hover:bg-[var(--osc-primary-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {configure.isPending ? "Applying…" : "Apply selection"}
                </button>
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
}: {
  studioLabel?: string
  studioId?: string
  onMenu: () => void
  /** studio pages stack a subnav — drop the bottom border to avoid a double line */
  edge?: "border" | "flush"
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
      </div>
    </header>
  )
}

function HomePage() {
  const studiosQuery = useStudios()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerPanel, setDrawerPanel] = useState<"nav" | "settings">("nav")

  const openSettings = () => {
    setDrawerPanel("settings")
    setDrawerOpen(true)
  }
  const openMenu = () => {
    setDrawerPanel("nav")
    setDrawerOpen(true)
  }

  const cards = (studiosQuery.data?.studios ?? []).filter((s) => s.enabled)

  return (
    <div className="min-h-dvh bg-[var(--osc-bg)]">
      <TopBar onMenu={openMenu} />
      <SideDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} initialPanel={drawerPanel} />

      <main className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
        <div className="osc-reveal mb-12">
          <p className="mb-3 text-[11px] font-medium tracking-[0.16em] text-[var(--osc-text-faint)] uppercase">Companion</p>
          <h1 className="text-[2.15rem] leading-[1.1] font-semibold tracking-[-0.04em] text-[var(--osc-text)] sm:text-[2.5rem]">Studios</h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--osc-text-muted)]">
            Open a domain viewer. Manage enablement from the menu.
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

        {!studiosQuery.isLoading && cards.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--osc-border-strong)] px-6 py-20 text-center">
            <p className="text-[15px] font-medium text-[var(--osc-text)]">No studios enabled</p>
            <p className="mt-1.5 text-[13px] text-[var(--osc-text-muted)]">Turn on CAD, Media, PCB, or Startup in Settings.</p>
            <button
              type="button"
              onClick={openSettings}
              className="mt-6 inline-flex h-9 items-center rounded-full bg-[var(--osc-primary)] px-5 text-[12px] font-medium text-[var(--osc-primary-fg)] transition-colors hover:bg-[var(--osc-primary-hover)]"
            >
              Open settings
            </button>
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
                <p className="mb-6 flex-1 text-[13px] leading-relaxed text-[var(--osc-text-muted)]">{studio.description}</p>
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--osc-text)]">
                  Open viewer
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
  media: lazy(async () => {
    await import("@studios/media/viewer/src/styles.css")
    const mod = await import("@studios/media/viewer/src/app")
    return { default: mod.App }
  }),
  pcb: lazy(async () => {
    await import("@studios/pcb/viewer/src/styles.css")
    const mod = await import("@studios/pcb/viewer/src/app")
    return { default: mod.App }
  }),
  startup: lazy(async () => {
    await import("@studios/startup/viewer/src/styles.css")
    const mod = await import("@studios/startup/viewer/src/app")
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

function StudioFrame() {
  const { studioId = "" } = useParams()
  const studiosQuery = useStudios()
  const [drawerOpen, setDrawerOpen] = useState(false)

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
        <TopBar studioLabel="Loading…" onMenu={() => setDrawerOpen(true)} />
        <p className="p-8 text-sm text-[var(--osc-text-muted)]">Loading…</p>
      </div>
    )
  }
  if (!studiosQuery.data?.enabled.includes(studioId)) {
    return <Navigate to="/" replace />
  }

  const card = studiosQuery.data.studios.find((s) => s.id === studioId)
  const Viewer = isStudioId(studioId) ? viewerLoaders[studioId] : undefined
  const page = Viewer ? <Viewer /> : <p className="p-8 text-sm">Unknown studio</p>
  const label = card?.label ?? studioId

  return (
    <div data-studio={studioId} className="studio-shell flex min-h-dvh flex-col bg-[var(--osc-bg)]">
      {/* Always flush: first studio chrome (.studio-subnav or content) owns the bottom edge */}
      <TopBar studioLabel={label} studioId={studioId} onMenu={() => setDrawerOpen(true)} edge="flush" />
      <SideDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} studioId={studioId} initialPanel="nav" />
      <Suspense
        fallback={<div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--osc-text-muted)]">Loading studio…</div>}
      >
        {page}
      </Suspense>
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/studios/:studioId/*" element={<StudioFrame />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
