import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Link, Route, Routes, useParams } from "react-router"
import { api, type CircuitDiagnostics, type DiagnosticGroup, type PartSummary, type ProjectSummary, studioHref } from "./api"

const CadViewerTab = lazy(() => import("./cad-viewer-tab"))
const SchematicTab = lazy(() => import("./schematic-tab"))
const PcbTab = lazy(() => import("./pcb-tab"))
const BomTab = lazy(() => import("./bom-tab"))

// ── Utility ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ")
}

// ── Layout ───────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-studio="pcb"
      className="min-h-screen bg-[var(--osc-bg)] text-[var(--osc-text)] flex flex-col font-[family-name:var(--osc-font-ui)]"
    >
      <header className="border-b border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-6 py-3 flex items-center gap-4 shrink-0">
        <span className="text-lg font-semibold tracking-tight text-[var(--osc-accent)]">PCB Studio</span>
        <nav className="flex items-center gap-1 ml-4">
          <NavLink to={studioHref()}>Projects</NavLink>
          <NavLink to={studioHref("catalog")}>Catalog</NavLink>
        </nav>
        <WorkspaceBadge />
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const path = window.location.pathname.replace(/\/$/, "") || "/"
  const target = (to || "/").replace(/\/$/, "") || "/"
  const home = studioHref().replace(/\/$/, "") || "/"
  const active = target === home ? path === home : path === target || path.startsWith(`${target}/`)
  return (
    <Link
      to={to}
      className={cn(
        "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
        active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50",
      )}
    >
      {children}
    </Link>
  )
}

function WorkspaceBadge() {
  const { data } = useQuery({ queryKey: ["pcb", "workspace"], queryFn: api.workspace })
  if (!data) return null
  return (
    <span className="ml-auto text-xs text-zinc-500 truncate max-w-xs" title={data.root}>
      {data.root}
    </span>
  )
}

// ── Status badge ─────────────────────────────────────────────────────────────

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        ok ? "bg-emerald-950 text-emerald-400" : "bg-zinc-800 text-zinc-500",
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-emerald-400" : "bg-zinc-600")} />
      {label}
    </span>
  )
}

function HealthBadges({ project }: { project: ProjectSummary }) {
  if (!project.built) return null
  if (project.designValid === null) {
    return <StatusBadge tone="warning" label="Health unknown" />
  }
  return (
    <>
      {project.designValid ? (
        <StatusBadge tone="success" label="Valid" />
      ) : (
        <StatusBadge tone="error" label={`${project.errorCount} errors`} />
      )}
      {project.fabricationReady !== null && (
        <StatusBadge
          tone={project.fabricationReady ? "success" : "error"}
          label={project.fabricationReady ? "Fabrication ready" : "Fabrication blocked"}
        />
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
    success: "bg-emerald-950 text-emerald-400",
    warning: "bg-amber-950 text-amber-400",
    error: "bg-red-950 text-red-400",
  }
  const dots = { success: "bg-emerald-400", warning: "bg-amber-400", error: "bg-red-400" }
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
    <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">
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
  return <div className="flex items-center justify-center py-24 text-red-400 text-sm">{message}</div>
}

function EmptyState({ label }: { label: string }) {
  return <div className="flex items-center justify-center py-24 text-zinc-600 text-sm">{label}</div>
}

// ── Projects Page ─────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link to={studioHref(`projects/${encodeURIComponent(project.id)}`)} className="block group">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-600 hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-white truncate group-hover:text-zinc-100">{project.name}</p>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{project.path}</p>
          </div>
          <svg
            className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <HealthBadges project={project} />
          <Badge ok={project.built} label="circuit.json" />
          <Badge ok={project.hasSchematicSvg} label="schematic" />
          <Badge ok={project.hasPcbSvg} label="pcb" />
          <Badge ok={project.hasGerbersZip} label="gerbers" />
        </div>
      </div>
    </Link>
  )
}

function DiagnosticGroupList({ groups, tone }: { groups: DiagnosticGroup[]; tone: "warning" | "error" }) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <details key={group.type} open={tone === "error"} className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-mono text-zinc-300">
            {group.type} <span className={tone === "error" ? "text-red-400" : "text-amber-400"}>({group.count})</span>
          </summary>
          {group.messages.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-zinc-400">
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
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4" aria-label="Design diagnostics">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-white">Design diagnostics</h2>
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
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Projects</h1>
        {data && (
          <span className="text-sm text-zinc-500">
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

type ViewTab = "schematic" | "pcb" | "3d" | "json" | "bom"

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
    <div className="flex flex-col h-full min-h-[480px]">
      <div className="flex items-center gap-3 p-3 border-b border-zinc-800 shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter elements…"
          className="flex-1 bg-zinc-800 text-zinc-200 text-sm rounded px-3 py-1.5 outline-none placeholder-zinc-600 focus:ring-1 focus:ring-zinc-600"
        />
        <span className="text-xs text-zinc-500 shrink-0">
          {filtered.length} / {elements.length} elements
        </span>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4 text-xs font-mono">
        {types.map((type) => {
          const group = byType[type]
          if (!group) return null
          return (
            <details key={type} open={group.length <= 10}>
              <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200 py-1 select-none">
                <span className="text-emerald-400">{type}</span>
                <span className="text-zinc-600 ml-2">({group.length})</span>
              </summary>
              <div className="mt-1 space-y-1 pl-3 border-l border-zinc-800">
                {group.map((el: any, i: number) => (
                  <details key={i} className="group">
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300 py-0.5 select-none">
                      {el.name ?? el.source_component_id ?? el.source_net_id ?? `[${i}]`}
                    </summary>
                    <pre className="mt-1 bg-zinc-900 rounded p-2 text-zinc-300 overflow-auto text-xs leading-relaxed">
                      {JSON.stringify(el, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </details>
          )
        })}
        {Object.keys(byType).length === 0 && <p className="text-zinc-600">No elements match the filter.</p>}
      </div>
    </div>
  )
}

function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<ViewTab>("schematic")
  const buildState = useProjectEvents(id)

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
      <Shell>
        <LoadingState />
      </Shell>
    )
  if (error || !project)
    return (
      <Shell>
        <ErrorState message="Project not found" />
      </Shell>
    )

  return (
    <Shell>
      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-4 h-full">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to={studioHref()} className="text-zinc-500 hover:text-zinc-300 text-sm">
            ← Projects
          </Link>
          <span className="text-zinc-700">/</span>
          <h1 className="text-lg font-semibold text-white">{project.name}</h1>
          <span className="text-xs text-zinc-600 font-mono">{project.path}</span>
        </div>

        {/* Status row */}
        <div className="flex flex-wrap items-center gap-2">
          <HealthBadges project={project} />
          <Badge ok={project.built} label="circuit.json" />
          <Badge ok={project.hasSchematicSvg} label="schematic.svg" />
          <Badge ok={project.hasPcbSvg} label="pcb.svg" />
          <Badge ok={project.hasGerbersZip} label="gerbers.zip" />
          {buildState.status === "stale" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--osc-stale-bg)] px-2 py-0.5 text-xs font-medium text-[var(--osc-stale)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--osc-stale)]" />
              Source changed — rebuild with agent tools
            </span>
          )}
          {project.hasGerbersZip && id && (
            <a
              href={api.gerbersZipUrl(id)}
              download
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
            >
              Download Gerbers ↓
            </a>
          )}
          {project.assemblyReady && id && (
            <a
              href={api.assemblyCsvUrl(id)}
              download
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
            >
              Pick & Place ↓
            </a>
          )}
          {!project.built && (
            <p className="text-xs text-amber-400 ml-1">
              Run <code className="bg-zinc-800 px-1 rounded">pcb_circuit_build</code> in OpenCode to build this project.
            </p>
          )}
        </div>

        {project.diagnostics && <DiagnosticsPanel diagnostics={project.diagnostics} />}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-800">
          {(["schematic", "pcb", "bom", "3d", "json"] as ViewTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t ? "border-emerald-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300",
              )}
            >
              {t === "json" ? "Circuit JSON" : t === "schematic" ? "Schematic" : t === "pcb" ? "PCB Layout" : t === "bom" ? "BOM" : "3D"}
            </button>
          ))}
        </div>

        {/* Viewer */}
        <div className="flex-1">
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
    <tr className="border-b border-zinc-800 hover:bg-zinc-800/40 cursor-pointer transition-colors" onClick={onClick}>
      <td className="px-4 py-2.5 font-mono text-sm text-emerald-400 whitespace-nowrap">{part.mpn}</td>
      <td className="px-4 py-2.5 text-sm text-zinc-300 whitespace-nowrap">{part.manufacturer ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-zinc-400">{part.description ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-zinc-500 whitespace-nowrap">{part.category ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm">
        {part.datasheet && (
          <a
            href={part.datasheet}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-xs"
            onClick={(e) => e.stopPropagation()}
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop dismissal, Escape handled via useEffect
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Part detail: ${mpn}`}
        className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <span className="font-mono font-semibold text-emerald-400">{mpn}</span>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-5">
          {isLoading && <LoadingState />}
          {error && <ErrorState message="Failed to load part details" />}
          {data && (
            <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">{JSON.stringify(data, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
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
          <h1 className="text-xl font-semibold text-white">Component Catalog</h1>
          {data && (
            <span className="text-sm text-zinc-500">
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
            className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-zinc-500 placeholder-zinc-600"
          />
        </div>

        {isLoading && <LoadingState />}
        {error && <ErrorState message={String(error)} />}
        {data && data.parts.length === 0 && (
          <EmptyState label={search ? "No parts match your search." : "No catalog parts found in the workspace."} />
        )}

        {data && data.parts.length > 0 && (
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-zinc-900 border-b border-zinc-800">
                  <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">MPN</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Manufacturer</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Description</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider"></th>
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
      <Route path="catalog" element={<CatalogPage />} />
    </Routes>
  )
}
