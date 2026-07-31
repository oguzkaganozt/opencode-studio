import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { cn } from "@ui/lib/cn"
import { safeHref } from "@ui/lib/safe-href"
import { api, type CircuitDiagnostics, type DiagnosticGroup, type PartSummary, type ProjectSummary, studioHref } from "./api"
import { PartDetailModal } from "./part-detail"
import { ViewerErrorBoundary } from "./error-boundary"

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
        <nav className="flex items-center gap-0.5" aria-label="PCB sections">
          <NavLink to={studioHref()} end>
            Projects
          </NavLink>
          <NavLink to={studioHref("catalog")}>Catalog</NavLink>
        </nav>
        <WorkspaceBadge />
      </header>
      <div className={cn("min-h-0 flex-1", fill ? "flex flex-col overflow-hidden" : "overflow-auto")}>{children}</div>
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
  if (!project.designValid) return <StatusBadge tone="error" label={`Design · ${project.errorCount} errors`} />
  if (project.fabricationReady === false) return <StatusBadge tone="error" label="Fab blocked" />
  if (project.assemblyReady === false) return <StatusBadge tone="warning" label="Assembly blocked" />
  if ((project.warningCount ?? 0) > 0) return <StatusBadge tone="warning" label={`${project.warningCount} warnings`} />
  return <StatusBadge tone="success" label="Ready" />
}

function projectHealthTone(project: ProjectSummary): "success" | "warning" | "error" {
  if (!project.built || project.designValid === null) return "warning"
  if (!project.designValid || project.fabricationReady === false) return "error"
  if (project.assemblyReady === false || (project.warningCount ?? 0) > 0) return "warning"
  return "success"
}

/** Detail page: health + fab/assembly only (artifacts via downloads). */
function DetailHealth({ project }: { project: ProjectSummary }) {
  const items: Array<{ label: string; value: string; tone: "success" | "warning" | "error" }> = []
  if (!project.built) {
    items.push({ label: "Build", value: "Not built", tone: "warning" })
  } else if (project.designValid === null) {
    items.push({ label: "Design", value: "Unknown", tone: "warning" })
  } else {
    items.push({
      label: "Design",
      value: project.designValid ? "Valid" : `${project.errorCount} errors`,
      tone: project.designValid ? "success" : "error",
    })
    if (project.fabricationReady !== null) {
      items.push({
        label: "Fabrication",
        value: project.fabricationReady ? "Ready" : "Blocked",
        tone: project.fabricationReady ? "success" : "error",
      })
    }
    if (project.assemblyReady !== null) {
      items.push({
        label: "Assembly",
        value: project.assemblyReady ? "Ready" : "Blocked",
        tone: project.assemblyReady ? "success" : "warning",
      })
    }
  }

  return (
    <div className="pcb-readiness" role="status" aria-label="Project readiness">
      <span className="pcb-readiness__label">Readiness</span>
      <div className="pcb-readiness__items">
        {items.map((item) => (
          <span key={item.label} className="pcb-readiness__item" data-tone={item.tone}>
            <span className="pcb-readiness__dot" aria-hidden />
            <span className="pcb-readiness__name">{item.label}</span>
            <strong>{item.value}</strong>
          </span>
        ))}
      </div>
    </div>
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

function PageError({ message, description, onRetry }: { message: string; description?: string; onRetry?: () => void }) {
  return (
    <ErrorState
      className="m-4 border-dashed py-16 sm:m-6 sm:py-20"
      title={message}
      description={description}
      action={
        onRetry ? (
          <button type="button" className="pcb-chip" onClick={onRetry}>
            Retry
          </button>
        ) : undefined
      }
    />
  )
}

function PageEmpty({ label, description, action }: { label: string; description?: string; action?: React.ReactNode }) {
  return <EmptyState className="m-4 border-dashed py-16 sm:m-6 sm:py-20" title={label} description={description} action={action} />
}

// ── Projects Page ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      to={studioHref(`projects/${encodeURIComponent(project.id)}/schematic`)}
      className="pcb-card group"
      data-tone={projectHealthTone(project)}
    >
      <span className="pcb-card__rail" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold tracking-tight text-[var(--osc-text)]">{project.name}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--osc-text-muted)]" title={project.path}>
            {project.path}
          </p>
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
      <div className="pcb-card__artifacts" aria-label="Available artifacts">
        <span data-ready={project.hasSchematicSvg ? "true" : undefined} aria-label={`Schematic ${project.hasSchematicSvg ? "available" : "unavailable"}`}>
          Schematic
        </span>
        <span data-ready={project.hasPcbSvg ? "true" : undefined} aria-label={`PCB ${project.hasPcbSvg ? "available" : "unavailable"}`}>
          PCB
        </span>
        <span
          data-ready={project.hasGerbersZip && project.fabricationReady ? "true" : undefined}
          aria-label={`Gerbers ${project.hasGerbersZip && project.fabricationReady ? "fab-ready" : "unavailable"}`}
        >
          Gerbers
        </span>
      </div>
    </Link>
  )
}

function diagnosticLabel(type: string) {
  const words = type.replace(/_(warning|error)$/, "").split("_")
  const scope = words.shift()
  const scopeLabel = scope === "pcb" ? "PCB" : scope ? scope[0].toUpperCase() + scope.slice(1) : "Design"
  const message = words.join(" ")
  return message ? `${scopeLabel}: ${message[0].toUpperCase()}${message.slice(1)}` : scopeLabel
}

function DiagnosticGroupList({ groups, tone }: { groups: DiagnosticGroup[]; tone: "warning" | "error" }) {
  const count = groups.reduce((total, group) => total + group.count, 0)
  return (
    <section className="min-w-0 space-y-2" aria-label={tone === "error" ? "Errors" : "Warnings"}>
      <div className="pcb-diag-section-heading" data-tone={tone}>
        <span>{tone === "error" ? "Errors" : "Warnings"}</span>
        <span>
          {count} across {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <details key={group.type} open={tone === "error"} className="pcb-diag-group">
            <summary className="pcb-diag-group-summary">
              <span className="min-w-0">{diagnosticLabel(group.type)}</span>
              <span className="pcb-diag-group-count" data-tone={tone}>
                {group.count}
              </span>
            </summary>
            <div className="pcb-diag-group-content">
              <code>{group.type}</code>
              {group.messages.length > 0 && (
                <ul>
                  {group.messages.map((message, index) => (
                    <li key={`${group.type}-${index}`}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
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
  const [open, setOpen] = useState(diagnostics.errorCount > 0)

  const showToast = (message: string) => {
    setToast(message)
  }

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (diagnostics.errorCount > 0) setOpen(true)
  }, [diagnostics.errorCount])

  if (diagnostics.errorCount === 0 && diagnostics.warningCount === 0) return null

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
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
      <div className="pcb-diag-content space-y-3 overflow-auto overscroll-contain border-t border-[var(--osc-border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="pcb-chip"
            onClick={() => {
              requestAgentHandoff({
                text: formatDiagnosticsHandoff(projectId, projectName, diagnostics),
                source: "pcb",
                open: true,
                copyFallback: true,
              })
              showToast("Opened repair draft in agent")
            }}
          >
            Fix with agent
          </button>
          <span className="text-[11px] text-[var(--osc-text-muted)]">Review the draft before sending</span>
        </div>
        <div className={cn("grid gap-3", diagnostics.errors.length > 0 && diagnostics.warnings.length > 0 && "lg:grid-cols-2")}>
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

async function loadAllProjects() {
  const projects: ProjectSummary[] = []
  const limit = 200
  let offset = 0

  while (true) {
    const page = await api.projects({ limit, offset })
    projects.push(...page.projects)
    if (!page.hasMore || page.projects.length === 0) {
      return { projects, total: page.total, hasMore: false }
    }
    offset += page.projects.length
  }
}

function ProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["pcb", "projects"], queryFn: loadAllProjects })
  const search = searchParams.get("q") ?? ""
  const filter = searchParams.get("status") ?? "all"
  const normalizedSearch = search.trim().toLowerCase()
  const filteredProjects =
    data?.projects.filter((project) => {
      const matchesSearch = !normalizedSearch || `${project.name} ${project.path}`.toLowerCase().includes(normalizedSearch)
      if (!matchesSearch) return false
      if (filter === "ready") return projectHealthTone(project) === "success"
      if (filter === "attention") return project.built && projectHealthTone(project) !== "success"
      if (filter === "unbuilt") return !project.built
      return true
    }) ?? []

  const updateFilter = (key: "q" | "status", value: string) => {
    const next = new URLSearchParams(searchParams)
    if (!value || value === "all") next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const clearFilters = () => setSearchParams({}, { replace: true })

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Workspace</p>
          <h1 className="text-pretty text-xl font-semibold tracking-tight text-[var(--osc-text)] sm:text-2xl">Projects</h1>
        </div>
        {data && (
          <span className="font-mono text-[12px] text-[var(--osc-text-muted)] tabular-nums">
            {filteredProjects.length === data.total ? data.total : `${filteredProjects.length} of ${data.total}`} project
            {data.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {isLoading && <LoadingState />}
      {error && (
        <PageError
          message="Failed to load projects"
          description={`${String(error)}. Check the workspace and retry.`}
          onRetry={() => void refetch()}
        />
      )}
      {data && data.projects.length === 0 && (
        <PageEmpty
          label="No circuit projects yet"
          description="Create a project with src/circuit.tsx in the workspace (pcb_project_create), then build with the agent."
          action={
            <button
              type="button"
              className="pcb-chip pcb-chip--primary"
              onClick={() =>
                requestAgentHandoff({
                  text: "Create a new PCB project in this workspace, ask me for the circuit requirements, then build and validate it.",
                  source: "pcb",
                  open: true,
                  copyFallback: true,
                })
              }
            >
              Draft project request
            </button>
          }
        />
      )}
      {data && data.projects.length > 0 && (
        <>
          <div className="pcb-project-tools" role="search" aria-label="Filter projects">
            <label className="sr-only" htmlFor="pcb-project-search">
              Filter projects by name or path
            </label>
            <input
              id="pcb-project-search"
              type="search"
              name="project-filter"
              value={search}
              onChange={(event) => updateFilter("q", event.target.value)}
              placeholder="Filter projects…"
              autoComplete="off"
              spellCheck={false}
              className="pcb-input min-w-0 px-3"
            />
            <div className="pcb-project-filters" aria-label="Project status">
              {[
                ["all", "All"],
                ["ready", "Ready"],
                ["attention", "Needs attention"],
                ["unbuilt", "Not built"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="pcb-filter"
                  aria-pressed={filter === value}
                  onClick={() => updateFilter("status", value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredProjects.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <EmptyState
              className="border-dashed py-14"
              title="No projects match"
              description="Try another name, path, or readiness filter."
              action={
                <button type="button" className="pcb-chip" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            />
          )}
        </>
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
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pcb", "circuitJson", projectId],
    queryFn: async () => {
      const response = await fetch(api.circuitJsonUrl(projectId))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    },
  })
  const elements = Array.isArray(data) ? data : []
  const indexedElements = useMemo(
    () => elements.map((element: any) => ({ element, searchText: JSON.stringify(element).toLowerCase() })),
    [elements],
  )
  const types = [...new Set(elements.map((element: any) => String(element.type ?? "unknown")))].sort()
  const normalizedSearch = deferredSearch.trim().toLowerCase()
  const filtered = normalizedSearch
    ? indexedElements.filter(({ searchText }) => searchText.includes(normalizedSearch)).map(({ element }) => element)
    : elements

  if (isLoading) return <LoadingState label="Loading circuit.json…" />
  if (error)
    return (
      <PageError
        message="Circuit JSON is unavailable"
        description="Build the project if artifacts do not exist. If it is already built, retry the request."
        onRetry={() => void refetch()}
      />
    )
  if (!Array.isArray(data)) {
    return <PageError message="Circuit JSON has an unexpected format" description="Rebuild the project, then retry this view." onRetry={() => void refetch()} />
  }

  const byType: Record<string, any[]> = {}
  for (const el of filtered) {
    const t = (el as any).type ?? "unknown"
    if (!byType[t]) byType[t] = []
    byType[t].push(el)
  }
  const visibleTypes = types.filter((type) => byType[type])

  return (
    <div className="pcb-json-viewer flex min-h-[min(560px,50dvh)] flex-1 flex-col">
      <div className="pcb-json-toolbar">
        <label className="sr-only" htmlFor="pcb-circuit-json-filter">
          Filter elements
        </label>
        <input
          id="pcb-circuit-json-filter"
          type="search"
          name="circuit-json-filter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by type, name, or ID…"
          autoComplete="off"
          spellCheck={false}
          className="pcb-input flex-1 px-3 py-1.5"
        />
        <span className="shrink-0 text-xs text-[var(--osc-text-muted)] tabular-nums" aria-live="polite">
          {filtered.length === elements.length ? `${elements.length} elements` : `${filtered.length} of ${elements.length}`} · {visibleTypes.length}{" "}
          {visibleTypes.length === 1 ? "type" : "types"}
        </span>
      </div>
      <div className="pcb-json-list">
        {visibleTypes.map((type) => {
          const group = byType[type]
          if (!group) return null
          return (
            <details key={type} className="pcb-json-group">
              <summary className="pcb-json-summary">
                <span className="min-w-0 text-[var(--osc-accent)]">{type}</span>
                <span className="ml-auto shrink-0 pl-2 text-[var(--osc-text-faint)]">({group.length})</span>
              </summary>
              <div className="mt-1 space-y-1 pl-3 border-l border-[var(--osc-border)]">
                {group.map((el: any, i: number) => (
                  <details key={i} className="group">
                    <summary className="pcb-json-item-summary">
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
        {visibleTypes.length === 0 && (
          <div className="pcb-json-empty">
            <p className="font-medium text-[var(--osc-text)]">No elements match</p>
            <p>Try a type, component name, source ID, or net ID.</p>
            <button type="button" className="pcb-chip" onClick={() => setSearch("")}>
              Clear filter
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectPage() {
  const { id, tab: rawTab } = useParams<{ id: string; tab?: string }>()
  const navigate = useNavigate()
  const tab: ViewTab = isViewTab(rawTab) ? rawTab : "schematic"
  const buildState = useProjectEvents(id)
  const tablistRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!id) return
    if (!isViewTab(rawTab)) {
      navigate(studioHref(`projects/${encodeURIComponent(id)}/schematic`), { replace: true })
    }
  }, [id, rawTab, navigate])

  useEffect(() => {
    tablistRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [tab])

  const {
    data: project,
    isLoading,
    error,
    refetch,
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
  if (error)
    return (
      <Shell fill>
        <PageError
          message="Failed to load project"
          description={`${(error as Error).message}. Check the project path and retry.`}
          onRetry={() => void refetch()}
        />
      </Shell>
    )
  if (!project)
    return (
      <Shell fill>
        <PageError message="Project not found" description="It may have been removed from the workspace." />
      </Shell>
    )

  const requestBuild = () => {
    requestAgentHandoff({
      text: `Build the PCB project "${project.name}" (${project.id}), inspect all diagnostics, and verify designValid, fabricationReady, and assemblyReady.`,
      source: "pcb",
      open: true,
      copyFallback: true,
    })
  }

  return (
    <Shell fill>
      <div className="pcb-project-page mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-3 py-3 sm:px-6 sm:py-4">
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
          <p className="truncate font-mono text-[11px] text-[var(--osc-text-muted)]" title={project.path}>
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
          {(buildState.status === "stale" || !project.built) && (
            <button type="button" className="pcb-chip pcb-chip--primary" onClick={requestBuild}>
              {project.built ? "Draft rebuild request" : "Draft build request"}
            </button>
          )}
          {project.hasGerbersZip && project.fabricationReady && id && (
            <a href={api.gerbersZipUrl(id)} download className="pcb-chip">
              Gerbers ↓
            </a>
          )}
          {project.assemblyReady && id && (
            <a href={api.assemblyCsvUrl(id)} download className="pcb-chip">
              Pick & Place ↓
            </a>
          )}
        </div>

        {project.diagnostics && id && (
          <DiagnosticsPanel diagnostics={project.diagnostics} projectId={id} projectName={project.name} />
        )}

        <nav ref={tablistRef} className="pcb-tablist" aria-label="Project views. Scroll horizontally for more views.">
          {VIEW_TABS.map((t) => (
            <Link
              key={t}
              aria-current={tab === t ? "page" : undefined}
              to={studioHref(`projects/${encodeURIComponent(id!)}/${t}`)}
              className="pcb-tab shrink-0"
            >
              {tabLabel(t)}
            </Link>
          ))}
        </nav>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={`${tabLabel(tab)} view`}>
          <ViewerErrorBoundary
            resetKey={`${id}-${tab}`}
            fallback={
              <PageError
                message={`${tabLabel(tab)} view failed to load`}
                description="Reload the page to retry this viewer. Other project views remain available."
                onRetry={() => window.location.reload()}
              />
            }
          >
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
          </ViewerErrorBoundary>
        </section>
      </div>
    </Shell>
  )
}

// ── Catalog Page ──────────────────────────────────────────────────────────────

function PartRow({ part, onSelect }: { part: PartSummary; onSelect: () => void }) {
  const datasheetHref = part.datasheet ? safeHref(part.datasheet) : null
  return (
    <tr className="border-b border-[var(--osc-border)] transition-colors hover:bg-[var(--osc-surface-hover)]">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm">
        <button type="button" className="pcb-table-link" onClick={onSelect}>
          {part.mpn}
        </button>
      </td>
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
          >
            Datasheet ↗
          </a>
        )}
      </td>
    </tr>
  )
}

function PartCard({ part, onSelect }: { part: PartSummary; onSelect: () => void }) {
  const datasheetHref = part.datasheet ? safeHref(part.datasheet) : null
  return (
    <article className="pcb-data-card">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button type="button" className="pcb-table-link min-w-0 truncate text-left font-mono" onClick={onSelect}>
          {part.mpn}
        </button>
        {part.category ? <span className="pcb-data-card__tag">{part.category}</span> : null}
      </div>
      <p className="mt-2 text-[13px] text-[var(--osc-text)]">{part.manufacturer ?? "Manufacturer unknown"}</p>
      {part.description ? <p className="mt-1 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">{part.description}</p> : null}
      {datasheetHref ? (
        <a href={datasheetHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex text-xs text-[var(--osc-accent)]">
          Datasheet ↗
        </a>
      ) : null}
    </article>
  )
}

function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const search = searchParams.get("q") ?? ""
  const selected = searchParams.get("part")
  const debouncedSearch = useDebounce(search, 200)

  const updateCatalogSearch = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set("q", value)
    else next.delete("q")
    setSearchParams(next, { replace: true })
  }

  const selectPart = (mpn: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("part", mpn)
    setSearchParams(next, { state: { catalogPartModal: true } })
  }

  const closePart = () => {
    if ((location.state as { catalogPartModal?: boolean } | null)?.catalogPartModal) {
      navigate(-1)
      return
    }
    const next = new URLSearchParams(searchParams)
    next.delete("part")
    setSearchParams(next, { replace: true })
  }

  const requestCatalogHelp = () => {
    requestAgentHandoff({
      text: "Help populate the workspace PCB component catalog with verified manufacturer part numbers, metadata, datasheets, and usable footprint identities.",
      source: "pcb",
      open: true,
      copyFallback: true,
    })
  }

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["pcb", "catalog", debouncedSearch],
    queryFn: () => api.catalog(debouncedSearch || undefined),
    placeholderData: (previous) => previous,
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
            onChange={(e) => updateCatalogSearch(e.target.value)}
            placeholder="Search MPN, manufacturer…"
            autoComplete="off"
            spellCheck={false}
            className="pcb-input w-full px-3 py-2 sm:px-4 sm:py-2.5"
          />
        </div>

        {isFetching && !isLoading ? (
          <p className="mb-3 text-[11px] text-[var(--osc-text-muted)]" role="status">
            Searching catalog…
          </p>
        ) : null}

        {isLoading && <LoadingState />}
        {error && <PageError message="Failed to load catalog" description={`${String(error)}. Check the catalog and retry.`} onRetry={() => void refetch()} />}
        {data && data.parts.length === 0 && (
          <PageEmpty
            label={search ? "No parts match" : "Catalog is empty"}
            description={
              search
                ? "Try a shorter MPN or manufacturer token."
                : "Add parts under the workspace catalog directory, or search after parts exist."
            }
            action={
              !search ? (
                <button type="button" className="pcb-chip pcb-chip--primary" onClick={requestCatalogHelp}>
                  Add parts with agent
                </button>
              ) : undefined
            }
          />
        )}

        {data && data.parts.length > 0 && (
          <>
            <div className="pcb-table-wrap pcb-desktop-table overflow-x-auto">
              <table>
                <caption className="sr-only">PCB component catalog</caption>
                <thead>
                  <tr>
                    <th scope="col">MPN</th>
                    <th scope="col">Manufacturer</th>
                    <th scope="col">Description</th>
                    <th scope="col">Category</th>
                    <th scope="col">
                      <span className="sr-only">Datasheet</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.parts.map((p) => (
                    <PartRow key={p.mpn} part={p} onSelect={() => selectPart(p.mpn)} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pcb-mobile-list">
              {data.parts.map((part) => (
                <PartCard key={part.mpn} part={part} onSelect={() => selectPart(part.mpn)} />
              ))}
            </div>
          </>
        )}
      </div>

      {selected && <PartDetailModal mpn={selected} onClose={closePart} />}
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
          queryClient.invalidateQueries({ queryKey: ["pcb", "bom", projectId] })
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
