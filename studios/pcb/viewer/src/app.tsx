import { useViewerRefresh } from "@ui/agent/use-viewer-refresh"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { claimAgentContext } from "@ui/agent-context"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Badge } from "@ui/components/badge"
import { EmptyState } from "@ui/components/empty-state"
import { StudioHomeHeader, StudioHomeTools, patchSearchParams } from "@ui/components/studio-home"
import { cn } from "@ui/lib/cn"
import { api, type ProjectSummary, studioHref } from "./api"
import { CatalogPage } from "./catalog-page"
import { CircuitJsonViewer } from "./circuit-json-viewer"
import { DiagnosticsPanel } from "./diagnostics-panel"
import { ViewerErrorBoundary } from "./error-boundary"
import { LoadingState, PageEmpty, PageError } from "./page-states"
import { Shell } from "./shell"

const CadViewerTab = lazy(() => import("./cad-viewer-tab"))
const SchematicTab = lazy(() => import("./schematic-tab"))
const PcbTab = lazy(() => import("./pcb-tab"))
const BomTab = lazy(() => import("./bom-tab"))

/** Compact health for cards — one primary signal, optional warning count. */
function CardHealth({ project }: { project: ProjectSummary }) {
  if (project.artifactStatus === "stale")
    return (
      <Badge tone="fail" dot title={project.artifactError ?? undefined}>
        Stale build
      </Badge>
    )
  if (!project.built)
    return (
      <Badge tone="warn" dot>
        Not built
      </Badge>
    )
  if (project.designValid === null)
    return (
      <Badge tone="warn" dot>
        Health unknown
      </Badge>
    )
  if (!project.designValid)
    return (
      <Badge tone="fail" dot>
        Design · {project.errorCount} errors
      </Badge>
    )
  if (project.fabricationReady === false)
    return (
      <Badge tone="fail" dot>
        Fab blocked
      </Badge>
    )
  if (project.assemblyReady === false)
    return (
      <Badge tone="warn" dot>
        Assembly blocked
      </Badge>
    )
  if ((project.warningCount ?? 0) > 0)
    return (
      <Badge tone="warn" dot>
        {project.warningCount} warnings
      </Badge>
    )
  return (
    <Badge tone="ok" dot>
      Ready
    </Badge>
  )
}

function projectHealthTone(project: ProjectSummary): "success" | "warning" | "error" {
  if (project.artifactStatus === "stale") return "error"
  if (!project.built || project.designValid === null) return "warning"
  if (!project.designValid || project.fabricationReady === false) return "error"
  if (project.assemblyReady === false || (project.warningCount ?? 0) > 0) return "warning"
  return "success"
}

/** Detail page: health + fab/assembly only (artifacts via downloads). */
function DetailHealth({ project }: { project: ProjectSummary }) {
  const items: Array<{ label: string; value: string; tone: "success" | "warning" | "error" }> = []
  if (project.artifactStatus === "stale") {
    items.push({ label: "Build", value: "Stale", tone: "error" })
  } else if (!project.built) {
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

// ── Empty / Error / Loading states ────────────────────────────────────────────

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

async function loadAllProjects() {
  return api.projects({ all: true })
}

function ProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["pcb", "projects"], queryFn: loadAllProjects })
  const { data: rootInfo } = useQuery({ queryKey: ["pcb", "workspace"], queryFn: () => api.workspace() })
  useEffect(() => {
    if (!rootInfo?.root) return
    return claimAgentContext("pcb-root", {
      key: "pcb-root",
      kind: "pcb-root",
      studioId: "pcb",
      label: "PCB Studio",
      directory: rootInfo.root,
      historicalDirectory: rootInfo.root,
      status: "available",
    })
  }, [rootInfo?.root])
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
    setSearchParams(patchSearchParams(searchParams, key, value), { replace: true })
  }

  const clearFilters = () => setSearchParams({}, { replace: true })

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <StudioHomeHeader
        title="Projects"
        count={
          data
            ? `${filteredProjects.length === data.total ? data.total : `${filteredProjects.length} of ${data.total}`} project${data.total !== 1 ? "s" : ""}`
            : undefined
        }
      />
      {isLoading && <LoadingState />}
      {error && (
        <PageError
          message="Failed to load projects"
          description={`${String(error)}. Check Studio Home and retry.`}
          onRetry={() => void refetch()}
        />
      )}
      {data && data.projects.length === 0 && (
        <PageEmpty
          label="No circuit projects yet"
          description="Create a project with src/circuit.tsx in Studio Home, then build with the agent."
          action={
            <button
              type="button"
              className="pcb-chip pcb-chip--primary"
              onClick={() =>
                requestAgentHandoff({
                  text: "Create a new PCB project in Studio Home, ask me for the circuit requirements, then build and validate it.",
                  source: "pcb",
                  directory: rootInfo?.root,
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
          <StudioHomeTools
            searchId="pcb-project-search"
            searchLabel="Filter projects by name or path"
            searchPlaceholder="Filter projects…"
            search={search}
            onSearch={(value) => updateFilter("q", value)}
            filterAriaLabel="Project status"
            filter={filter}
            onFilter={(value) => updateFilter("status", value)}
            filters={[
              { value: "all", label: "All" },
              { value: "ready", label: "Ready" },
              { value: "attention", label: "Needs attention" },
              { value: "unbuilt", label: "Not built" },
            ]}
            toolsClassName="pcb-project-tools"
            filtersClassName="pcb-project-filters"
            searchClassName="pcb-input min-w-0 px-3"
            filterClassName="pcb-filter"
          />

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
  const { data: projectLocation } = useQuery({
    queryKey: ["pcb", "workspace", id],
    queryFn: () => api.workspace(id),
    enabled: !!id,
  })
  const agentDirectory = project?.directory ?? projectLocation?.directory

  useEffect(
    () =>
      claimAgentContext(`pcb:${id ?? "unknown"}`, {
        key: `pcb:${id ?? "unknown"}`,
        kind: "pcb-project",
        studioId: "pcb",
        projectId: id,
        relativePath: project?.path ?? projectLocation?.path,
        label: `PCB · ${project?.name ?? "Project"}`,
        directory: agentDirectory,
        historicalDirectory: agentDirectory,
        status: project?.directory ? "available" : error ? "missing" : "checking",
      }),
    [agentDirectory, error, id, project?.directory, project?.name, project?.path, projectLocation?.path],
  )

  const queryClient = useQueryClient()
  useViewerRefresh(project?.directory, () => {
    if (!id) return
    void queryClient.invalidateQueries({ queryKey: ["pcb", "project", id] })
    void queryClient.invalidateQueries({ queryKey: ["pcb", "projects"] })
    void queryClient.invalidateQueries({ queryKey: ["pcb", "circuitJson", id] })
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
        <PageError message="Project not found" description="It may have been removed from Studio Home." />
      </Shell>
    )

  const requestBuild = () => {
    requestAgentHandoff({
      text: `Build the PCB project "${project.name}" (${project.id}), inspect all diagnostics, and verify designValid, fabricationReady, and assemblyReady.`,
      source: "pcb",
      directory: project.directory,
      paths: [project.directory],
      open: true,
      copyFallback: true,
    })
  }
  const stale = project.artifactStatus === "stale" || buildState.status === "stale"

  const showPath = Boolean(project.path && project.path !== project.name && project.path !== project.id)

  return (
    <Shell fill hideProjectsNav>
      <div className="pcb-project-page mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-2 px-3 py-2.5 sm:gap-2.5 sm:px-6 sm:py-3">
        <header className="pcb-project-header shrink-0">
          <div className="pcb-project-header__title min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
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
            {showPath ? (
              <p className="truncate font-mono text-[11px] text-[var(--osc-text-muted)]" title={project.path}>
                {project.path}
              </p>
            ) : null}
          </div>
          <div className="pcb-project-header__meta">
            <DetailHealth project={project} />
            {stale && (
              <span className="inline-flex items-center gap-1.5 rounded-[var(--osc-radius-md)] border border-[var(--osc-stale)]/30 bg-[var(--osc-stale-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--osc-stale)]">
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--osc-stale)]" aria-hidden />
                Artifacts stale — rebuild
              </span>
            )}
            {(stale || !project.built) && (
              <button type="button" className="pcb-chip pcb-chip--primary" onClick={requestBuild}>
                {stale ? "Draft rebuild request" : "Draft build request"}
              </button>
            )}
            {project.hasGerbersZip && project.fabricationReady && id && (
              <a href={api.gerbersZipUrl(id)} download className="pcb-chip pcb-chip--action">
                Gerbers ↓
              </a>
            )}
            {project.assemblyReady && id && (
              <a href={api.assemblyCsvUrl(id)} download className="pcb-chip pcb-chip--action">
                Pick & Place ↓
              </a>
            )}
          </div>
        </header>

        {project.artifactStatus === "stale" && project.artifactError && (
          <p className="shrink-0 text-xs text-[var(--osc-error)]" role="status">
            {project.artifactError}
          </p>
        )}

        {project.diagnostics && id && (
          <DiagnosticsPanel diagnostics={project.diagnostics} projectId={id} projectName={project.name} directory={project.directory} />
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

        <section className="pcb-project-view flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={`${tabLabel(tab)} view`}>
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
                <SchematicTab projectId={id} directory={project.directory} />
              </Suspense>
            )}
            {tab === "pcb" && id && (
              <Suspense fallback={<LoadingState label="Loading PCB viewer…" />}>
                <PcbTab projectId={id} directory={project.directory} />
              </Suspense>
            )}
            {tab === "3d" && id && (
              <Suspense fallback={<LoadingState label="Loading 3D viewer…" />}>
                <CadViewerTab projectId={id} />
              </Suspense>
            )}
            {tab === "bom" && id && (
              <Suspense fallback={<LoadingState label="Loading BOM…" />}>
                <BomTab projectId={id} directory={project.directory} />
              </Suspense>
            )}
            {tab === "json" && id && <CircuitJsonViewer projectId={id} directory={project.directory} />}
          </ViewerErrorBoundary>
        </section>
      </div>
    </Shell>
  )
}

// ── Catalog Page ──────────────────────────────────────────────────────────────

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
