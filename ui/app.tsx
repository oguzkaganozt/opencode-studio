import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useState } from "react"
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

type StudiosResponse = {
  workspace: string
  enabled: string[]
  configError?: string
  packageVersion: string
  studios: StudioCard[]
  restartRequiredHint: string
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ?? body?.error ?? `Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            OpenCode Studio
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}

function HomePage() {
  const queryClient = useQueryClient()
  const studiosQuery = useQuery({
    queryKey: ["host", "studios"],
    queryFn: () => fetchJson<StudiosResponse>("/api/studios"),
  })
  const csrfQuery = useQuery({
    queryKey: ["host", "csrf"],
    queryFn: () => fetchJson<{ token: string }>("/api/csrf"),
  })

  const [selected, setSelected] = useState<string[] | null>(null)
  const enabled = selected ?? studiosQuery.data?.enabled ?? []

  const configure = useMutation({
    mutationFn: async (next: string[]) => {
      const token = csrfQuery.data?.token
      if (!token) throw new Error("CSRF token unavailable")
      return fetchJson("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
        },
        body: JSON.stringify({ enabled: next }),
      })
    },
    onSuccess: async () => {
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ["host"] })
    },
  })

  const cards = studiosQuery.data?.studios ?? []

  return (
    <Shell>
      <div className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold">Studios</h1>
        <p className="max-w-2xl text-sm text-[var(--osc-text-muted)]">
          Installing the package does not enable Studios. Select the exact set for this workspace, apply, then restart OpenCode and the
          Studio host.
        </p>
        {studiosQuery.isLoading && <p className="text-sm text-[var(--osc-text-muted)]">Loading studios…</p>}
        {studiosQuery.isError && (
          <p className="rounded border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-3 py-2 text-sm" role="alert">
            Failed to load studios: {(studiosQuery.error as Error)?.message ?? "unknown error"}
          </p>
        )}
        {csrfQuery.isError && (
          <p className="rounded border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-3 py-2 text-sm" role="alert">
            Failed to load CSRF token; configuration is unavailable until the host is reachable.
          </p>
        )}
        {studiosQuery.data && (
          <p className="font-mono text-xs text-[var(--osc-text-faint)]">
            workspace {studiosQuery.data.workspace} · v{studiosQuery.data.packageVersion}
          </p>
        )}
        {studiosQuery.data?.configError && (
          <p className="rounded border border-[var(--osc-error)] bg-[var(--osc-error-bg)] px-3 py-2 text-sm">
            Config error: {studiosQuery.data.configError}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((studio) => {
          const on = enabled.includes(studio.id)
          return (
            <div
              key={studio.id}
              className={`rounded-md border p-4 transition ${
                on ? "border-[var(--osc-accent)] bg-[var(--osc-bg-elevated)]" : "border-[var(--osc-border)] bg-[var(--osc-bg-subtle)]"
              }`}
              data-studio={studio.id}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-lg font-medium">{studio.label}</h2>
                <label className="flex items-center gap-2 text-xs text-[var(--osc-text-muted)]">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      setSelected((current) => {
                        const base = current ?? studiosQuery.data?.enabled ?? []
                        return on ? base.filter((id) => id !== studio.id) : [...base, studio.id]
                      })
                    }}
                  />
                  <span className="font-mono uppercase tracking-wide">{on ? "enabled" : "disabled"}</span>
                </label>
              </div>
              <p className="mb-3 text-sm text-[var(--osc-text-muted)]">{studio.description}</p>
              <dl className="space-y-1 font-mono text-xs text-[var(--osc-text-faint)]">
                <div>
                  <dt className="inline text-[var(--osc-text-muted)]">root </dt>
                  <dd className="inline break-all">{studio.root ?? studio.rootError ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-[var(--osc-text-muted)]">engines </dt>
                  <dd className="inline">{studio.requiredEngines.join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt className="inline text-[var(--osc-text-muted)]">skill </dt>
                  <dd className="inline">{studio.skillInstalled ? studio.skill : `${studio.skill} (not installed)`}</dd>
                </div>
              </dl>
              {on && (
                <div className="mt-3">
                  <Link to={`/studios/${studio.id}`} className="text-sm text-[var(--osc-accent)] underline-offset-2 hover:underline">
                    Open viewer
                  </Link>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={configure.isPending || !csrfQuery.data}
          onClick={() => configure.mutate(enabled)}
          className="rounded bg-[var(--osc-accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {configure.isPending ? "Applying…" : "Apply selection"}
        </button>
        {configure.isSuccess && (
          <p className="text-sm text-[var(--osc-warning)]" role="status">
            Applied. Restart OpenCode and opencode-studio serve.
          </p>
        )}
        {configure.isError && (
          <p className="text-sm text-[var(--osc-error)]" role="alert">
            {(configure.error as Error).message}
          </p>
        )}
      </div>
    </Shell>
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
  const studiosQuery = useQuery({
    queryKey: ["host", "studios"],
    queryFn: () => fetchJson<StudiosResponse>("/api/studios"),
  })

  const uiBasePath = `/studios/${studioId}`
  const apiBasePath = `/api/studios/${studioId}`

  // Synchronous so first paint / first fetch see the correct mount bases.
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
      <Shell>
        <p>Loading…</p>
      </Shell>
    )
  }
  if (!studiosQuery.data?.enabled.includes(studioId)) {
    return <Navigate to="/" replace />
  }

  const Viewer = isStudioId(studioId) ? viewerLoaders[studioId] : undefined
  const page = Viewer ? <Viewer /> : <p>Unknown studio</p>

  return (
    <div data-studio={studioId} className="studio-shell flex min-h-dvh flex-col">
      <div className="shrink-0 border-b border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-4 py-2 text-sm">
        <Link to="/" className="text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]">
          ← Studios
        </Link>
        <span className="mx-2 text-[var(--osc-text-faint)]">/</span>
        <span className="font-medium">{studioId}</span>
      </div>
      <Suspense fallback={<div className="p-6 text-sm text-[var(--osc-text-muted)]">Loading studio…</div>}>{page}</Suspense>
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
