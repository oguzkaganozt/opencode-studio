import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useState } from "react"
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { cn } from "@ui/lib/cn"
import { safeHref } from "@ui/lib/safe-href"
import { api, type CircuitDiagnostics, type DiagnosticGroup, type PartSummary, type ProjectSummary, studioHref } from "./api"
import { PartDetailModal } from "./part-detail"

const CadViewerTab = lazy(() => import("./cad-viewer-tab"))
const SchematicTab = lazy(() => import("./schematic-tab"))
const PcbTab = lazy(() => import("./pcb-tab"))
const BomTab = lazy(() => import("./bom-tab"))

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
  // Basename-relative path (BrowserRouter basename=/studio); never window.location.
  const { pathname } = useLocation()
  const path = pathname.replace(/\/$/, "") || "/"
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
    <span className="pcb-workspace-badge" title={data.root}>
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
    success: "border-[var(--osc-success)]/30 bg-[var(--osc-success-bg)] text-[var(--osc-success)]",
    warning: "border-[var(--osc-warning)]/30 bg-[var(--osc-warning-bg)] text-[var(--osc-warning)]",
    error: "border-[var(--osc-error)]/30 bg-[var(--osc-error-bg)] text-[var(--osc-error)]",
  }
  const dots = { success: "bg-[var(--osc-success)]", warning: "bg-[var(--osc-warning)]", error: "bg-[var(--osc-error)]" }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase",
        colors[tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", dots[tone])} aria-hidden />
      {label}
    </span>
  )
}

// ── Empty / Error / Loading states ────────────────────────────────────────────

function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-3 py-10" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="pcb-skeleton h-16 w-full" aria-hidden />
      <div className="pcb-skeleton h-16 w-full" aria-hidden />
      <div className="pcb-skeleton h-16 w-3/4" aria-hidden />
    </div>
  )
}

function PageError({ message, description }: { message: string; description?: string }) {
  return <ErrorState className="m-4 border-dashed py-16 sm:m-6 sm:py-20" title={message} description={description} />
}

function PageEmpty({ label, description }: { label: string; description?: string }) {
  return <EmptyState className="m-4 border-dashed py-16 sm:m-6 sm:py-20" title={label} description={description} />
}

// ── Projects Page ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link to={studioHref(`projects/${encodeURIComponent(project.id)}/schematic`)} className="pcb-card group">
      <span className="pcb-card__rail" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold tracking-tight text-[var(--osc-text)]">{project.name}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--osc-text-faint)]">{project.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CardHealth project={project} />
          <svg
            className="mt-0.5 h-4 w-4 text-[var(--osc-text-faint)] transition-transform duration-[var(--osc-motion-duration)] group-hover:translate-x-0.5 group-hover:text-[var(--osc-text-muted)]"
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
      {project.hasGerbersZip && <p className="mt-3 text-[11px] text-[var(--osc-text-faint)]">Gerbers available</p>}
    </Link>
  )
}

function DiagnosticGroupList({ groups, tone }: { groups: DiagnosticGroup[]; tone: "warning" | "error" }) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <details
          key={group.type}
          open={tone === "error"}
          className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg)] px-3 py-2"
        >
          <summary className="cursor-pointer font-mono text-xs text-[var(--osc-text)]">
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

function formatDiagnosticsHandoff(projectId: string, projectName: string, diagnostics: CircuitDiagnostics) {
  const lines = [
    `PCB project "${projectName}" (${projectId}) has design diagnostics that need fixing.`,
    `Errors: ${diagnostics.errorCount}, warnings: ${diagnostics.warningCount}.`,
    "Use pcb_circuit_build / pcb_circuit_read, fix issues, and re-check designValid / fabricationReady / assemblyReady.",
  ]
  for (const group of diagnostics.errors) {
    lines.push(`Error ${group.type} (${group.count}):`)
    for (const message of group.messages.slice(0, 8)) lines.push(`  - ${message}`)
    if (group.messages.length > 8) lines.push(`  - … ${group.messages.length - 8} more`)
  }
  for (const group of diagnostics.warnings) {
    lines.push(`Warning ${group.type} (${group.count}):`)
    for (const message of group.messages.slice(0, 5)) lines.push(`  - ${message}`)
    if (group.messages.length > 5) lines.push(`  - … ${group.messages.length - 5} more`)
  }
  return lines.join("\n")
}

function DiagnosticsPanel({
  diagnostics,
  projectId,
  projectName,
}: {
  diagnostics: CircuitDiagnostics
  projectId: string
  projectName: string
}) {
  const [toast, setToast] = useState<string | null>(null)
  if (diagnostics.errorCount === 0 && diagnostics.warningCount === 0) return null

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 1800)
  }

  return (
    <details
      className="relative shrink-0 rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow)]"
      aria-label="Design diagnostics"
    >
      <summary className="pcb-diag-summary">
        <span className="pcb-diag-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        Design diagnostics
        {diagnostics.errorCount > 0 && <StatusBadge tone="error" label={`${diagnostics.errorCount} errors`} />}
        {diagnostics.warningCount > 0 && <StatusBadge tone="warning" label={`${diagnostics.warningCount} warnings`} />}
      </summary>
      <div className="max-h-48 space-y-3 overflow-auto overscroll-contain border-t border-[var(--osc-border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="pcb-chip"
            onClick={() => {
              requestAgentHandoff({
                text: formatDiagnosticsHandoff(projectId, projectName, diagnostics),
                source: "pcb",
              })
              showToast("Prompt ready in agent")
            }}
          >
            Send to agent
          </button>
          <span className="text-[11px] text-[var(--osc-text-faint)]">Draft prompt — not auto-sent</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {diagnostics.errors.length > 0 && <DiagnosticGroupList groups={diagnostics.errors} tone="error" />}
          {diagnostics.warnings.length > 0 && <DiagnosticGroupList groups={diagnostics.warnings} tone="warning" />}
        </div>
      </div>
      {toast && (
        <div
          className="absolute top-2 right-3 z-10 rounded-[var(--osc-radius-md)] border border-[var(--osc-success)]/30 bg-[var(--osc-success-bg)] px-3 py-1.5 text-xs font-medium text-[var(--osc-success)]"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </details>
  )
}

function ProjectsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["pcb", "projects"], queryFn: () => api.projects({ limit: 100 }) })

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Workspace</p>
          <h1 className="text-pretty text-xl font-semibold tracking-tight text-[var(--osc-text)] sm:text-2xl">Projects</h1>
        </div>
        {data && (
          <span className="font-mono text-[12px] text-[var(--osc-text-muted)] tabular-nums">
            {data.total} project{data.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {isLoading && <LoadingState />}
      {error && (
        <PageError
          message="Failed to load projects"
          description={String(error)}
        />
      )}
      {data && data.projects.length === 0 && (
        <PageEmpty
          label="No circuit projects yet"
          description="Create a project with src/circuit.tsx in the workspace (pcb_project_create), then build with the agent."
        />
      )}
      {data && data.projects.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
  if (error) return <PageError message="circuit.json not available. Run pcb_circuit_build first." />

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
    <div className="flex min-h-[min(560px,50dvh)] flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--osc-border)] p-3">
        <label className="sr-only" htmlFor="pcb-circuit-json-filter">
          Filter elements
        </label>
        <input
          id="pcb-circuit-json-filter"
          type="search"
          name="circuit-json-filter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter elements…"
          autoComplete="off"
          spellCheck={false}
          className="pcb-input flex-1 px-3 py-1.5"
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
        <PageError message="Project not found" />
      </Shell>
    )

  return (
    <Shell fill>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-3 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0 shrink-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to={studioHref()}
              className="shrink-0 rounded-[var(--osc-radius-md)] px-1.5 py-1 text-sm text-[var(--osc-text-muted)] transition-colors hover:bg-[var(--osc-surface)] hover:text-[var(--osc-text)]"
            >
              ← Projects
            </Link>
            <span className="shrink-0 text-[var(--osc-border-strong)]" aria-hidden>
              /
            </span>
            <h1 className="min-w-0 truncate text-base font-semibold tracking-tight text-[var(--osc-text)] sm:text-lg">{project.name}</h1>
          </div>
          <p className="truncate font-mono text-[11px] text-[var(--osc-text-faint)]" title={project.path}>
            {project.path}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DetailHealth project={project} />
          {buildState.status === "stale" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--osc-stale)]/30 bg-[var(--osc-stale-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--osc-stale)]">
              <span className="size-1.5 shrink-0 rounded-full bg-[var(--osc-stale)]" aria-hidden />
              Source changed — rebuild
            </span>
          )}
          {project.hasGerbersZip && id && (
            <a href={api.gerbersZipUrl(id)} download className="pcb-chip">
              Gerbers ↓
            </a>
          )}
          {project.assemblyReady && id && (
            <a href={api.assemblyCsvUrl(id)} download className="pcb-chip">
              Pick & Place ↓
            </a>
          )}
          {!project.built && (
            <p className="w-full text-xs text-[var(--osc-warning)] sm:ml-1 sm:w-auto">
              Run <code className="rounded-[var(--osc-radius-sm)] bg-[var(--osc-surface)] px-1 font-mono text-[11px]">pcb_circuit_build</code>{" "}
              to build.
            </p>
          )}
        </div>

        {project.diagnostics && id && (
          <DiagnosticsPanel diagnostics={project.diagnostics} projectId={id} projectName={project.name} />
        )}

        <div className="pcb-tablist" role="tablist" aria-label="Project views">
          {VIEW_TABS.map((t) => (
            <Link
              key={t}
              role="tab"
              aria-selected={tab === t}
              to={studioHref(`projects/${encodeURIComponent(id!)}/${t}`)}
              className="pcb-tab shrink-0"
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
  const datasheetHref = part.datasheet ? safeHref(part.datasheet) : null
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
        {datasheetHref && (
          <a
            href={datasheetHref}
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
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
          <div>
            <p className="mb-1 text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Library</p>
            <h1 className="text-pretty text-xl font-semibold tracking-tight text-[var(--osc-text)] sm:text-2xl">Component Catalog</h1>
          </div>
          {data && (
            <span className="font-mono text-[12px] text-[var(--osc-text-muted)] tabular-nums">
              {data.total} part{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="mb-4">
          <label className="sr-only" htmlFor="pcb-catalog-search">
            Search catalog
          </label>
          <input
            id="pcb-catalog-search"
            type="search"
            name="catalog-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search MPN, manufacturer…"
            autoComplete="off"
            spellCheck={false}
            className="pcb-input w-full px-3 py-2 sm:px-4 sm:py-2.5"
          />
        </div>

        {isLoading && <LoadingState />}
        {error && <PageError message="Failed to load catalog" description={String(error)} />}
        {data && data.parts.length === 0 && (
          <PageEmpty
            label={search ? "No parts match" : "Catalog is empty"}
            description={
              search
                ? "Try a shorter MPN or manufacturer token."
                : "Add parts under the workspace catalog directory, or search after parts exist."
            }
          />
        )}

        {data && data.parts.length > 0 && (
          <div className="pcb-table-wrap overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>MPN</th>
                  <th>Manufacturer</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>
                    <span className="sr-only">Datasheet</span>
                  </th>
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
