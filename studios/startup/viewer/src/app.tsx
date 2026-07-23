function apiBase() {
  return (window as any).__OPENCODE_STUDIO__?.apiBase ?? "/api/studios/startup"
}
function api(path: string) {
  return `${apiBase().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
}
function studioHref(path = "") {
  const runtime = (window as any).__OPENCODE_STUDIO__ as { uiBase?: string } | undefined
  const base = (runtime?.uiBase ?? "").replace(/\/$/, "")
  const suffix = path.replace(/^\//, "")
  if (!base) return suffix ? `/${suffix}` : "/"
  return suffix ? `${base}/${suffix}` : base
}

import { useQuery } from "@tanstack/react-query"
import { Link, Route, Routes, useParams, useSearchParams } from "react-router"

type StudioInfo = { id: string; packageVersion: string; contractVersion?: string }

type CandidateSummary = {
  name: string
  total: number
  signal_class: "A" | "B"
  verdict: "verified" | "partial" | "unverified"
  one_liner: string
  buyer: string
  shelf: string
  first_seen: string
}

type Evidence = { url: string; date?: string; engagement?: string; summary: string }

type PoolEntry = CandidateSummary & {
  problem: string
  evidence: Evidence[]
  verify_summary?: string
  rubric: { pain: number; payment: number; shelf: number; freshness: number; fit: number }
  status: string
  batch: string
  evaluation?: {
    pros: string
    cons: string
    risks: string
    recommendation: string
    updated_at: string
  }
}

type RejectSummary = {
  name: string
  problem: string
  reason: string
  batch: string
  first_seen: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json() as Promise<T>
}

function verdictClass(verdict: string) {
  if (verdict === "verified") return "text-[var(--osc-success)]"
  if (verdict === "partial") return "text-[var(--osc-warning)]"
  return "text-[var(--osc-text-faint)]"
}

function StudioBar({ studio }: { studio?: StudioInfo }) {
  return (
    <header className="flex h-10 items-center justify-between border-b border-[var(--osc-border)] px-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-semibold tracking-wide" data-studio="startup">
          Startup Studio
        </span>
        <span className="mono text-xs text-[var(--osc-text-muted)]">{studio ? `${studio.id}@${studio.packageVersion}` : "loading"}</span>
      </div>
      <nav className="flex items-center gap-3 text-xs">
        <Link className="text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]" to={studioHref()}>
          Pool
        </Link>
        <Link className="text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]" to={studioHref("rejects")}>
          Rejects
        </Link>
        <span className="mono text-[var(--osc-text-faint)]">OSC {studio?.contractVersion ?? "…"}</span>
      </nav>
    </header>
  )
}

function CandidateRail({ candidates, selectedId }: { candidates: CandidateSummary[]; selectedId?: string }) {
  return (
    <aside className="w-72 shrink-0 overflow-auto border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)]">
      <div className="border-b border-[var(--osc-border)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">
        Candidates
      </div>
      <nav className="flex flex-col p-1">
        {candidates.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[var(--osc-text-muted)]">No candidates in pool.</p>
        ) : (
          candidates.map((c) => {
            const active = c.name === selectedId
            return (
              <Link
                key={c.name}
                to={studioHref(`candidates/${c.name}`)}
                className={`rounded-[var(--osc-radius-md)] px-2 py-1.5 text-sm ${
                  active
                    ? "bg-[var(--osc-surface)] text-[var(--osc-text)]"
                    : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="mono text-[11px] text-[var(--osc-accent)]">{c.total}</span>
                </div>
                <div className="mono mt-0.5 flex gap-2 text-[11px] text-[var(--osc-text-faint)]">
                  <span>{c.signal_class}</span>
                  <span className={verdictClass(c.verdict)}>{c.verdict}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-[var(--osc-text-muted)]">{c.one_liner}</div>
              </Link>
            )
          })
        )}
      </nav>
    </aside>
  )
}

function CandidateViewport({ id }: { id?: string }) {
  const query = useQuery({
    queryKey: ["startup", "candidate", id],
    enabled: Boolean(id),
    queryFn: () => fetchJson<PoolEntry>(api(`/candidates/${id}`)),
  })

  if (!id) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[var(--osc-canvas-bg)] text-[var(--osc-text-muted)]">
        Select a candidate to inspect.
      </main>
    )
  }

  if (query.isLoading) {
    return <main className="flex flex-1 items-center justify-center text-[var(--osc-text-muted)]">Loading…</main>
  }

  if (query.isError || !query.data) {
    return (
      <main className="flex flex-1 items-center justify-center text-[var(--osc-error)]" role="alert">
        Candidate not found.
      </main>
    )
  }

  const c = query.data
  return (
    <main className="flex flex-1 flex-col overflow-auto bg-[var(--osc-canvas-bg)] p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <span className="mono text-lg text-[var(--osc-accent)]">{c.total}/10</span>
        <span className={`mono text-xs ${verdictClass(c.verdict)}`}>{c.verdict}</span>
        <span className="mono text-xs text-[var(--osc-text-faint)]">class {c.signal_class}</span>
      </div>
      <p className="mb-4 text-[var(--osc-text-muted)]">{c.one_liner}</p>

      <section className="mb-6">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">Problem</h2>
        <p className="text-sm leading-relaxed">{c.problem}</p>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="mb-1 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">Buyer</h2>
          <p className="text-sm">{c.buyer}</p>
        </div>
        <div>
          <h2 className="mb-1 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">Shelf</h2>
          <p className="text-sm">{c.shelf}</p>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">Evidence</h2>
        <ul className="space-y-3">
          {c.evidence.map((e) => (
            <li key={e.url} className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3">
              <a
                className="mono text-xs text-[var(--osc-accent)] underline-offset-2 hover:underline"
                href={e.url}
                target="_blank"
                rel="noreferrer"
              >
                {e.url}
              </a>
              <p className="mt-1 text-sm text-[var(--osc-text-muted)]">{e.summary}</p>
              <div className="mono mt-1 flex gap-3 text-[11px] text-[var(--osc-text-faint)]">
                {e.date ? <span>{e.date}</span> : null}
                {e.engagement ? <span>{e.engagement}</span> : null}
              </div>
            </li>
          ))}
        </ul>
        {c.verify_summary ? (
          <p className="mt-3 text-sm text-[var(--osc-text-muted)]">
            <span className="text-[var(--osc-text-faint)]">Verify: </span>
            {c.verify_summary}
          </p>
        ) : null}
      </section>

      {c.evaluation ? (
        <section className="mb-6">
          <h2 className="mb-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">Paper evaluation</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-[var(--osc-text-faint)]">Pros</dt>
              <dd>{c.evaluation.pros}</dd>
            </div>
            <div>
              <dt className="text-[var(--osc-text-faint)]">Cons</dt>
              <dd>{c.evaluation.cons}</dd>
            </div>
            <div>
              <dt className="text-[var(--osc-text-faint)]">Risks</dt>
              <dd>{c.evaluation.risks}</dd>
            </div>
            <div>
              <dt className="text-[var(--osc-text-faint)]">Recommendation</dt>
              <dd>{c.evaluation.recommendation}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </main>
  )
}

function Inspector({ entry }: { entry?: PoolEntry }) {
  const r = entry?.rubric
  return (
    <aside className="hidden w-64 shrink-0 overflow-auto border-l border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] md:block">
      <div className="border-b border-[var(--osc-border)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">
        Inspector
      </div>
      <dl className="space-y-3 p-3 text-sm">
        <div>
          <dt className="text-[var(--osc-text-muted)]">Total</dt>
          <dd className="mono text-[var(--osc-accent)]">{entry ? `${entry.total}/10` : "—"}</dd>
        </div>
        {r
          ? (["pain", "payment", "shelf", "freshness", "fit"] as const).map((key) => (
              <div key={key}>
                <dt className="text-[var(--osc-text-muted)]">{key}</dt>
                <dd className="mono">{r[key]}</dd>
              </div>
            ))
          : null}
        <div>
          <dt className="text-[var(--osc-text-muted)]">Batch</dt>
          <dd className="mono text-xs">{entry?.batch ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--osc-text-muted)]">First seen</dt>
          <dd className="mono text-xs">{entry?.first_seen ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--osc-text-muted)]">Status</dt>
          <dd className="mono text-xs">{entry?.status ?? "—"}</dd>
        </div>
      </dl>
    </aside>
  )
}

function StatusStrip({ count, label }: { count: number; label: string }) {
  return (
    <footer className="flex h-7 items-center border-t border-[var(--osc-border)] px-3 text-xs text-[var(--osc-text-muted)]">
      <span className="mono">
        {count} {label}
      </span>
      <span className="mx-2 text-[var(--osc-text-faint)]">|</span>
      <span>Read-only Companion</span>
    </footer>
  )
}

function FilterBar() {
  const [params, setParams] = useSearchParams()
  const signalClass = params.get("signalClass") ?? ""
  const verdict = params.get("verdict") ?? ""

  function set(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--osc-border)] px-3 py-1.5 text-xs">
      <label className="flex items-center gap-1 text-[var(--osc-text-muted)]">
        Class
        <select
          className="rounded border border-[var(--osc-border)] bg-[var(--osc-surface)] px-1.5 py-0.5 text-[var(--osc-text)]"
          value={signalClass}
          onChange={(e) => set("signalClass", e.target.value)}
        >
          <option value="">all</option>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-[var(--osc-text-muted)]">
        Verdict
        <select
          className="rounded border border-[var(--osc-border)] bg-[var(--osc-surface)] px-1.5 py-0.5 text-[var(--osc-text)]"
          value={verdict}
          onChange={(e) => set("verdict", e.target.value)}
        >
          <option value="">all</option>
          <option value="verified">verified</option>
          <option value="partial">partial</option>
          <option value="unverified">unverified</option>
        </select>
      </label>
    </div>
  )
}

function PoolShell() {
  const params = useParams()
  const [search] = useSearchParams()
  const selectedId = params.id
  const signalClass = search.get("signalClass")
  const verdict = search.get("verdict")

  const qs = new URLSearchParams()
  if (signalClass) qs.set("signalClass", signalClass)
  if (verdict) qs.set("verdict", verdict)
  const listUrl = api(`/candidates${qs.toString() ? `?${qs}` : ""}`)

  const studioQuery = useQuery({
    queryKey: ["startup", "studio"],
    queryFn: () => fetchJson<{ packageVersion: string }>("/api/studios").then((b) => ({ id: "startup" as const, packageVersion: b.packageVersion })),
  })
  const listQuery = useQuery({
    queryKey: ["startup", "candidates", signalClass, verdict],
    queryFn: async () => (await fetchJson<{ candidates: CandidateSummary[] }>(listUrl)).candidates,
  })
  const detailQuery = useQuery({
    queryKey: ["startup", "candidate", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => fetchJson<PoolEntry>(api(`/candidates/${selectedId}`)),
  })

  const candidates = listQuery.data ?? []

  return (
    <div className="flex h-full flex-col" data-studio="startup">
      <StudioBar studio={studioQuery.data} />
      <FilterBar />
      <div className="flex min-h-0 flex-1">
        <CandidateRail candidates={candidates} selectedId={selectedId} />
        <CandidateViewport id={selectedId} />
        <Inspector entry={detailQuery.data} />
      </div>
      <StatusStrip count={candidates.length} label="candidates" />
    </div>
  )
}

function RejectsShell() {
  const studioQuery = useQuery({
    queryKey: ["startup", "studio"],
    queryFn: () => fetchJson<{ packageVersion: string }>("/api/studios").then((b) => ({ id: "startup" as const, packageVersion: b.packageVersion })),
  })
  const rejectsQuery = useQuery({
    queryKey: ["startup", "rejects"],
    queryFn: async () => (await fetchJson<{ rejects: RejectSummary[] }>(api("/rejects"))).rejects,
  })
  const rejects = rejectsQuery.data ?? []

  return (
    <div className="flex h-full flex-col" data-studio="startup">
      <StudioBar studio={studioQuery.data} />
      <main className="flex-1 overflow-auto p-4">
        <h1 className="mb-3 text-lg font-semibold">Rejects</h1>
        {rejects.length === 0 ? (
          <p className="text-sm text-[var(--osc-text-muted)]">No rejects.</p>
        ) : (
          <ul className="space-y-2">
            {rejects.map((r) => (
              <li key={r.name} className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3">
                <div className="mono text-sm font-medium">{r.name}</div>
                <p className="mt-1 text-sm text-[var(--osc-text-muted)]">{r.problem}</p>
                <p className="mt-1 text-xs text-[var(--osc-error)]">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
      <StatusStrip count={rejects.length} label="rejects" />
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route index element={<PoolShell />} />
      <Route path="candidates/:id" element={<PoolShell />} />
      <Route path="rejects" element={<RejectsShell />} />
      <Route
        path="*"
        element={
          <div className="flex h-full items-center justify-center text-[var(--osc-error)]" role="alert">
            Route not found.
          </div>
        }
      />
    </Routes>
  )
}
