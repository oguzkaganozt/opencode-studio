import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useState } from "react"
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router"
import { Dialog, DialogHeader } from "@ui/components/dialog"
import { api, type CircuitDiagnostics, type DiagnosticGroup, type PartSummary, type ProjectSummary, studioHref } from "./api"

function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

const CadViewerTab = lazy(() => import("./cad-viewer-tab"))
const SchematicTab = lazy(() => import("./schematic-tab"))
const PcbTab = lazy(() => import("./pcb-tab"))
const BomTab = lazy(() => import("./bom-tab"))

// ── Utility ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ")
}

// ── Layout ───────────────────────────────────────────────────────────────────

function Shell({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <div data-studio="pcb" className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)] text-[var(--osc-text)]">
      <header className="studio-subnav">
        <span className="sr-only">PCB Studio</span>
        <nav className="flex items-center gap-0.5">
          <NavLink to={studioHref()} end>
            Projects
          </NavLink>
          <NavLink to={studioHref("catalog")}>Catalog</NavLink>
        </nav>
        <WorkspaceBadge />
      </header>
      <main className={cn("min-h-0 flex-1", fill ? "flex flex-col overflow-hidden" : "overflow-auto")}>{children}</main>
    </div>
  )
}

function NavLink({ to, children, end = false }: { to: string; children: React.ReactNode; end?: boolean }) {
  const path = window.location.pathname.replace(/\/$/, "") || "/"
  const target = (to || "/").replace(/\/$/, "") || "/"
  const active = end ? path === target : path === target || path.startsWith(`${target}/`)
  return (
    <Link to={to} aria-current={active ? "page" : undefined} className={cn(active && "font-medium")}>
      {children}
    </Link>
  )
}

function WorkspaceBadge() {
  const { data } = useQuery({ queryKey: ["pcb", "workspace"], queryFn: api.workspace })
  if (!data) return null
  return (
    <span className="ml-auto text-xs text-[var(--osc-text-faint)] truncate max-w-xs" title={data.root}>
      {data.root}
    </span>
  )
}

// ── Status badge ─────────────────────────────────────────────────────────────

/** Compact health for cards — one primary signal, optional warning count. */
function CardHealth({ project }: { project: ProjectSummary }) {
  if (!project.built) return <StatusBadge tone="warning" label="Not built" />
  if (project.designValid === null) return <StatusBadge tone="warning" label="Health unknown" />
  if (!project.designValid) return <StatusBadge tone="error" label={`${project.errorCount} errors`} />
  if (project.fabricationReady === false) return <StatusBadge tone="error" label="Fab blocked" />
  if ((project.warningCount ?? 0) > 0) return <StatusBadge tone="warning" label={`${project.warningCount} warnings`} />
  return <StatusBadge tone="success" label="Valid" />
}

/** Detail page: health + fab/assembly only (artifacts via downloads). */
function DetailHealth({ project }: { project: ProjectSummary }) {
  if (!project.built) return <StatusBadge tone="warning" label="Not built" />
  if (project.designValid === null) return <StatusBadge tone="warning" label="Health unknown" />
  return (
    <>
      {project.designValid ? (
        <StatusBadge tone="success" label="Valid" />
      ) : (
        <StatusBadge tone="error" label={`${project.errorCount} errors`} />
      )}
      {project.fabricationReady !== null && (
        <StatusBadge tone={project.fabricationReady ? "success" : "error"} label={project.fabricationReady ? "Fab ready" : "Fab blocked"} />
      )}
      {project.assemblyReady !== null && (
        <StatusBadge
          tone={project.assemblyReady ? "success" : "warning"}
          label={project.assemblyReady ? "Assembly ready" : "Assembly blocked"}
        />
      )}
      {(project.warningCount ?? 0) > 0 && <StatusBadge tone="warning" label={`${project.warningCount} warnings`} />}
    </>
  )
}

function StatusBadge({ tone, label }: { tone: "success" | "warning" | "error"; label: string }) {
  const colors = {
    success: "bg-[var(--osc-success-bg)] text-[var(--osc-success)]",
    warning: "bg-[var(--osc-warning-bg)] text-[var(--osc-warning)]",
    error: "bg-[var(--osc-error-bg)] text-[var(--osc-error)]",
  }
  const dots = { success: "bg-[var(--osc-success)]", warning: "bg-[var(--osc-warning)]", error: "bg-[var(--osc-error)]" }
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", colors[tone])}>
      <span className={cn("w-1.5 h-1.5 rounded-full", dots[tone])} />
      {label}
    </span>
  )
}

// ── Empty / Error / Loading states ────────────────────────────────────────────

function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-24 text-[var(--osc-text-muted)] text-sm">
      <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" aria-label="Loading" role="img">
        <title>Loading</title>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return <div className="flex items-center justify-center py-24 text-[var(--osc-error)] text-sm">{message}</div>
}

function EmptyState({ label }: { label: string }) {
  return <div className="flex items-center justify-center py-24 text-[var(--osc-text-faint)] text-sm">{label}</div>
}

// ── Projects Page ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link to={studioHref(`projects/${encodeURIComponent(project.id)}/schematic`)} className="group block">
      <div className="rounded-lg border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4 transition-colors hover:border-[var(--osc-border-strong)] hover:bg-[var(--osc-surface-hover)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--osc-text)]">{project.name}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--osc-text-faint)]">{project.path}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CardHealth project={project} />
            <svg
              className="mt-0.5 h-4 w-4 text-[var(--osc-text-faint)] group-hover:text-[var(--osc-text-muted)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </div>
        {project.hasGerbersZip && <p className="mt-2 text-[11px] text-[var(--osc-text-faint)]">Gerbers available</p>}
      </div>
    </Link>
  )
}

function DiagnosticGroupList({ groups, tone }: { groups: DiagnosticGroup[]; tone: "warning" | "error" }) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <details key={group.type} open={tone === "error"} className="rounded border border-[var(--osc-border)] bg-[var(--osc-bg)] px-3 py-2">
          <summary className="cursor-pointer text-xs font-mono text-[var(--osc-text)]">
            {group.type} <span className={tone === "error" ? "text-[var(--osc-error)]" : "text-[var(--osc-warning)]"}>({group.count})</span>
          </summary>
          {group.messages.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-[var(--osc-text-muted)]">
              {group.messages.map((message, index) => (
                <li key={`${group.type}-${index}`}>{message}</li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </div>
  )
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: CircuitDiagnostics }) {
  if (diagnostics.errorCount === 0 && diagnostics.warningCount === 0) return null
  return (
    <section className="rounded-lg border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4" aria-label="Design diagnostics">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[var(--osc-text)]">Design diagnostics</h2>
        {diagnostics.errorCount > 0 && <StatusBadge tone="error" label={`${diagnostics.errorCount} errors`} />}
        {diagnostics.warningCount > 0 && <StatusBadge tone="warning" label={`${diagnostics.warningCount} warnings`} />}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {diagnostics.errors.length > 0 && <DiagnosticGroupList groups={diagnostics.errors} tone="error" />}
        {diagnostics.warnings.length > 0 && <DiagnosticGroupList groups={diagnostics.warnings} tone="warning" />}
      </div>
    </section>
  )
}

function ProjectsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["pcb", "projects"], queryFn: () => api.projects({ limit: 100 }) })

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Workspace</p>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--osc-text)]">Projects</h1>
        </div>
        {data && (
          <span className="text-sm text-[var(--osc-text-muted)]">
            {data.total} project{data.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={String(error)} />}
      {data && data.projects.length === 0 && (
        <EmptyState label="No circuit projects found. Create a project with a src/circuit.tsx file in the workspace." />
      )}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Project / Circuit Viewer ──────────────────────────────────────────────────

const VIEW_TABS = ["schematic", "pcb", "bom", "3d", "json"] as const
type ViewTab = (typeof VIEW_TABS)[number]

function isViewTab(value: string | undefined): value is ViewTab {
  return VIEW_TABS.includes(value as ViewTab)
}

function tabLabel(tab: ViewTab) {
  if (tab === "json") return "Circuit JSON"
  if (tab === "schematic") return "Schematic"
  if (tab === "pcb") return "PCB Layout"
  if (tab === "bom") return "BOM"
  return "3D"
}

function CircuitJsonViewer({ projectId }: { projectId: string }) {
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(api.circuitJsonUrl(projectId))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => {
        setData(json)
        setLoading(false)
      })
      .catch((e) => {
        setError(String(e))
        setLoading(false)
      })
  }, [projectId])

  if (loading) return <LoadingState label="Loading circuit.json…" />
  if (error) return <ErrorState message="circuit.json not available. Run pcb_circuit_build first." />

  const elements = Array.isArray(data) ? data : []
  const types = [...new Set(elements.map((e: any) => e.type as string))].sort()
  const filtered = search ? elements.filter((e: any) => JSON.stringify(e).toLowerCase().includes(search.toLowerCase())) : elements

  const byType: Record<string, any[]> = {}
  for (const el of filtered) {
    const t = (el as any).type ?? "unknown"
    if (!byType[t]) byType[t] = []
    byType[t].push(el)
  }

  return (
    <div className="flex h-full min-h-[min(560px,50dvh)] flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--osc-border)] p-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter elements…"
          className="flex-1 bg-[var(--osc-surface)] text-[var(--osc-text)] text-sm rounded px-3 py-1.5 outline-none placeholder:text-[var(--osc-text-faint)] focus:ring-1 focus:ring-[var(--osc-border-strong)]"
        />
        <span className="text-xs text-[var(--osc-text-muted)] shrink-0">
          {filtered.length} / {elements.length} elements
        </span>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4 text-xs font-mono">
        {types.map((type) => {
          const group = byType[type]
          if (!group) return null
          return (
            <details key={type} open={group.length <= 10}>
              <summary className="cursor-pointer text-[var(--osc-text-muted)] hover:text-[var(--osc-text)] py-1 select-none">
                <span className="text-[var(--osc-accent)]">{type}</span>
                <span className="text-[var(--osc-text-faint)] ml-2">({group.length})</span>
              </summary>
              <div className="mt-1 space-y-1 pl-3 border-l border-[var(--osc-border)]">
                {group.map((el: any, i: number) => (
                  <details key={i} className="group">
                    <summary className="cursor-pointer text-[var(--osc-text-muted)] hover:text-[var(--osc-text)] py-0.5 select-none">
                      {el.name ?? el.source_component_id ?? el.source_net_id ?? `[${i}]`}
                    </summary>
                    <pre className="mt-1 bg-[var(--osc-bg)] rounded p-2 text-[var(--osc-text-muted)] overflow-auto text-xs leading-relaxed">
                      {JSON.stringify(el, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </details>
          )
        })}
        {Object.keys(byType).length === 0 && <p className="text-[var(--osc-text-faint)]">No elements match the filter.</p>}
      </div>
    </div>
  )
}

function ProjectPage() {
  const { id, tab: rawTab } = useParams<{ id: string; tab?: string }>()
  const navigate = useNavigate()
  const tab: ViewTab = isViewTab(rawTab) ? rawTab : "schematic"
  const buildState = useProjectEvents(id)

  useEffect(() => {
    if (!id) return
    if (!isViewTab(rawTab)) {
      navigate(studioHref(`projects/${encodeURIComponent(id)}/schematic`), { replace: true })
    }
  }, [id, rawTab, navigate])

  const {
    data: project,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["pcb", "project", id],
    queryFn: () => api.project(id!),
    enabled: !!id,
  })

  if (isLoading)
    return (
      <Shell fill>
        <LoadingState />
      </Shell>
    )
  if (error || !project)
    return (
      <Shell fill>
        <ErrorState message="Project not found" />
      </Shell>
    )

  return (
    <Shell fill>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link to={studioHref()} className="text-sm text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]">
            ← Projects
          </Link>
          <span className="text-[var(--osc-border-strong)]">/</span>
          <h1 className="text-lg font-semibold text-[var(--osc-text)]">{project.name}</h1>
          <span className="font-mono text-xs text-[var(--osc-text-faint)]">{project.path}</span>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DetailHealth project={project} />
          {buildState.status === "stale" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--osc-stale-bg)] px-2 py-0.5 text-xs font-medium text-[var(--osc-stale)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--osc-stale)]" />
              Source changed — rebuild with agent tools
            </span>
          )}
          {project.hasGerbersZip && id && (
            <a
              href={api.gerbersZipUrl(id)}
              download
              className="inline-flex items-center gap-1 rounded-md border border-[var(--osc-border-strong)] px-2 py-0.5 text-xs text-[var(--osc-text-muted)] transition-colors hover:border-[var(--osc-text-faint)] hover:text-[var(--osc-text)]"
            >
              Download Gerbers ↓
            </a>
          )}
          {project.assemblyReady && id && (
            <a
              href={api.assemblyCsvUrl(id)}
              download
              className="inline-flex items-center gap-1 rounded-md border border-[var(--osc-border-strong)] px-2 py-0.5 text-xs text-[var(--osc-text-muted)] transition-colors hover:border-[var(--osc-text-faint)] hover:text-[var(--osc-text)]"
            >
              Pick & Place ↓
            </a>
          )}
          {!project.built && (
            <p className="ml-1 text-xs text-[var(--osc-warning)]">
              Run <code className="rounded bg-[var(--osc-surface)] px-1">pcb_circuit_build</code> to build this project.
            </p>
          )}
        </div>

        {project.diagnostics && (
          <div className="max-h-40 shrink-0 overflow-auto">
            <DiagnosticsPanel diagnostics={project.diagnostics} />
          </div>
        )}

        <div className="flex shrink-0 gap-1 border-b border-[var(--osc-border)]" role="tablist" aria-label="Project views">
          {VIEW_TABS.map((t) => (
            <Link
              key={t}
              role="tab"
              aria-selected={tab === t}
              to={studioHref(`projects/${encodeURIComponent(id!)}/${t}`)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors sm:px-4",
                tab === t
                  ? "border-[var(--osc-text)] text-[var(--osc-text)]"
                  : "border-transparent text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]",
              )}
            >
              {tabLabel(t)}
            </Link>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
          {tab === "schematic" && id && (
            <Suspense fallback={<LoadingState label="Loading schematic viewer…" />}>
              <SchematicTab projectId={id} />
            </Suspense>
          )}
          {tab === "pcb" && id && (
            <Suspense fallback={<LoadingState label="Loading PCB viewer…" />}>
              <PcbTab projectId={id} />
            </Suspense>
          )}
          {tab === "3d" && id && (
            <Suspense fallback={<LoadingState label="Loading 3D viewer…" />}>
              <CadViewerTab projectId={id} />
            </Suspense>
          )}
          {tab === "bom" && id && (
            <Suspense fallback={<LoadingState label="Loading BOM…" />}>
              <BomTab projectId={id} />
            </Suspense>
          )}
          {tab === "json" && id && <CircuitJsonViewer projectId={id} />}
        </div>
      </div>
    </Shell>
  )
}

// ── Catalog Page ──────────────────────────────────────────────────────────────

function PartRow({ part, onClick }: { part: PartSummary; onClick: () => void }) {
  return (
    <tr
      className="cursor-pointer border-b border-[var(--osc-border)] transition-colors hover:bg-[var(--osc-surface-hover)] focus-visible:bg-[var(--osc-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--osc-text)]"
      tabIndex={0}
      aria-label={`Part ${part.mpn}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm text-[var(--osc-accent)]">{part.mpn}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-[var(--osc-text)]">{part.manufacturer ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)]">{part.description ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-[var(--osc-text-muted)]">{part.category ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm">
        {part.datasheet && safeHref(part.datasheet) && (
          <a
            href={safeHref(part.datasheet)!}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--osc-accent)] hover:opacity-80"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            Datasheet ↗
          </a>
        )}
      </td>
    </tr>
  )
}

function PartDetailModal({ mpn, onClose }: { mpn: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["pcb", "part", mpn], queryFn: () => api.catalogPart(mpn) })

  return (
    <Dialog open onClose={onClose} title={`Part detail: ${mpn}`}>
      <DialogHeader title={mpn} onClose={onClose} />
      <div className="p-5">
        {isLoading && <LoadingState />}
        {error && <ErrorState message="Failed to load part details" />}
        {data && (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--osc-text)]">{JSON.stringify(data, null, 2)}</pre>
        )}
      </div>
    </Dialog>
  )
}

function CatalogPage() {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const debouncedSearch = useDebounce(search, 200)

  const { data, isLoading, error } = useQuery({
    queryKey: ["pcb", "catalog", debouncedSearch],
    queryFn: () => api.catalog(debouncedSearch || undefined),
  })

  return (
    <Shell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-[var(--osc-text)]">Component Catalog</h1>
          {data && (
            <span className="text-sm text-[var(--osc-text-muted)]">
              {data.total} part{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by MPN, manufacturer, description…"
            className="w-full bg-[var(--osc-surface)] border border-[var(--osc-border-strong)] text-[var(--osc-text)] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[var(--osc-border-strong)] placeholder:text-[var(--osc-text-faint)]"
          />
        </div>

        {isLoading && <LoadingState />}
        {error && <ErrorState message={String(error)} />}
        {data && data.parts.length === 0 && (
          <EmptyState label={search ? "No parts match your search." : "No catalog parts found in the workspace."} />
        )}

        {data && data.parts.length > 0 && (
          <div className="border border-[var(--osc-border)] rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[var(--osc-bg-elevated)] border-b border-[var(--osc-border)]">
                  <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-faint)] uppercase tracking-wider">MPN</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-faint)] uppercase tracking-wider">Manufacturer</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-faint)] uppercase tracking-wider">Description</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-faint)] uppercase tracking-wider">Category</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-faint)] uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {data.parts.map((p) => (
                  <PartRow key={p.mpn} part={p} onClick={() => setSelected(p.mpn)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && <PartDetailModal mpn={selected} onClose={() => setSelected(null)} />}
    </Shell>
  )
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

/** Subscribe to observation-only project events (no Companion rebuilds). */
function useProjectEvents(projectId: string | undefined) {
  const queryClient = useQueryClient()
  const [buildState, setBuildState] = useState<{ status: "idle" | "stale" }>({ status: "idle" })

  useEffect(() => {
    if (!projectId) return
    const es = new EventSource(api.eventsUrl())
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string)
        if (event.projectId !== projectId) return
        if (event.type === "source-changed") setBuildState({ status: "stale" })
        if (event.type === "artifacts-changed") {
          setBuildState({ status: "idle" })
          queryClient.invalidateQueries({ queryKey: ["pcb", "circuitJson", projectId] })
          queryClient.invalidateQueries({ queryKey: ["pcb", "project", projectId] })
          queryClient.invalidateQueries({ queryKey: ["pcb", "projects"] })
        }
      } catch {
        // malformed event — ignore
      }
    }
    return () => es.close()
  }, [projectId, queryClient])

  return buildState
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <Routes>
      <Route
        index
        element={
          <Shell>
            <ProjectsPage />
          </Shell>
        }
      />
      <Route path="projects/:id" element={<ProjectPage />} />
      <Route path="projects/:id/:tab" element={<ProjectPage />} />
      <Route path="catalog" element={<CatalogPage />} />
      <Route path="*" element={<Navigate to={studioHref()} replace />} />
    </Routes>
  )
}
