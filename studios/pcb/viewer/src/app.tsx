import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Link, Route, Routes, useParams } from "react-router"
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div data-studio="pcb" className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)] text-[var(--osc-text)]">
      <header className="studio-subnav">
        <span className="sr-only">PCB Studio</span>
        <nav className="flex items-center gap-0.5">
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

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        ok ? "bg-[var(--osc-success-bg)] text-[var(--osc-success)]" : "bg-[var(--osc-surface)] text-[var(--osc-text-faint)]",
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-[var(--osc-success)]" : "bg-[var(--osc-text-faint)]")} />
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
    <Link to={studioHref(`projects/${encodeURIComponent(project.id)}`)} className="block group">
      <div className="rounded-lg border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4 hover:border-[var(--osc-border-strong)] hover:bg-[var(--osc-surface-hover)] transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-[var(--osc-text)] truncate">{project.name}</p>
            <p className="text-xs text-[var(--osc-text-faint)] mt-0.5 truncate">{project.path}</p>
          </div>
          <svg
            className="w-4 h-4 text-[var(--osc-text-faint)] group-hover:text-[var(--osc-text-muted)] shrink-0 mt-0.5"
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
      <div className="flex items-center gap-3 p-3 border-b border-[var(--osc-border)] shrink-0">
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
          <Link to={studioHref()} className="text-[var(--osc-text-muted)] hover:text-[var(--osc-text)] text-sm">
            ← Projects
          </Link>
          <span className="text-[var(--osc-border-strong)]">/</span>
          <h1 className="text-lg font-semibold text-[var(--osc-text)]">{project.name}</h1>
          <span className="text-xs text-[var(--osc-text-faint)] font-mono">{project.path}</span>
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
              className="inline-flex items-center gap-1 rounded-md border border-[var(--osc-border-strong)] px-2 py-0.5 text-xs text-[var(--osc-text-muted)] hover:border-[var(--osc-text-faint)] hover:text-[var(--osc-text)] transition-colors"
            >
              Download Gerbers ↓
            </a>
          )}
          {project.assemblyReady && id && (
            <a
              href={api.assemblyCsvUrl(id)}
              download
              className="inline-flex items-center gap-1 rounded-md border border-[var(--osc-border-strong)] px-2 py-0.5 text-xs text-[var(--osc-text-muted)] hover:border-[var(--osc-text-faint)] hover:text-[var(--osc-text)] transition-colors"
            >
              Pick & Place ↓
            </a>
          )}
          {!project.built && (
            <p className="text-xs text-[var(--osc-warning)] ml-1">
              Run <code className="bg-[var(--osc-surface)] px-1 rounded">pcb_circuit_build</code> in OpenCode to build this project.
            </p>
          )}
        </div>

        {project.diagnostics && <DiagnosticsPanel diagnostics={project.diagnostics} />}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--osc-border)]">
          {(["schematic", "pcb", "bom", "3d", "json"] as ViewTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t ? "border-[var(--osc-text)] text-[var(--osc-text)]" : "border-transparent text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]",
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
    <tr className="border-b border-[var(--osc-border)] hover:bg-[var(--osc-surface-hover)] cursor-pointer transition-colors" onClick={onClick}>
      <td className="px-4 py-2.5 font-mono text-sm text-[var(--osc-accent)] whitespace-nowrap">{part.mpn}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text)] whitespace-nowrap">{part.manufacturer ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)]">{part.description ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)] whitespace-nowrap">{part.category ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm">
        {part.datasheet && safeHref(part.datasheet) && (
          <a
            href={safeHref(part.datasheet)!}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--osc-accent)] hover:opacity-80 text-xs"
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
        className="bg-[var(--osc-bg-elevated)] border border-[var(--osc-border-strong)] rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--osc-border)]">
          <span className="font-mono font-semibold text-[var(--osc-accent)]">{mpn}</span>
          <button type="button" onClick={onClose} className="text-[var(--osc-text-muted)] hover:text-[var(--osc-text)] text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-5">
          {isLoading && <LoadingState />}
          {error && <ErrorState message="Failed to load part details" />}
          {data && (
            <pre className="text-xs font-mono text-[var(--osc-text)] whitespace-pre-wrap leading-relaxed">{JSON.stringify(data, null, 2)}</pre>
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
      <Route path="catalog" element={<CatalogPage />} />
    </Routes>
  )
}
