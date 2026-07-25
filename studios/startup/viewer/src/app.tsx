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

import { useQuery } from "@tanstack/react-query"
import { Link, Route, Routes, useParams, useSearchParams } from "react-router"

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

function SubNav({ active }: { active: "pool" | "rejects" }) {
  return (
    <div className="studio-subnav">
      <span className="sr-only">Startup Studio</span>
      {(
        [
          ["pool", "Pool", studioHref()],
          ["rejects", "Rejects", studioHref("rejects")],
        ] as const
      ).map(([id, label, to]) => (
        <Link key={id} to={to} aria-current={active === id ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </div>
  )
}

function CandidateRail({ candidates, selectedId }: { candidates: CandidateSummary[]; selectedId?: string }) {
  return (
    <aside className="w-72 shrink-0 overflow-auto border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)]">
      <div className="border-b border-[var(--osc-border)] px-4 py-3 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">
        Candidates
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {candidates.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <p className="text-[13px] font-medium text-[var(--osc-text)]">Pool is empty</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">
              Mine and score candidates with agent tools, then refresh.
            </p>
          </div>
        ) : (
          candidates.map((c) => {
            const active = c.name === selectedId
            return (
              <Link
                key={c.name}
                to={studioHref(`candidates/${c.name}`)}
                className={`rounded-[var(--osc-radius-md)] px-2.5 py-2 text-[13px] transition-colors ${
                  active
                    ? "bg-[var(--osc-surface)] text-[var(--osc-text)] shadow-[var(--osc-shadow)]"
                    : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="mono text-[11px] text-[var(--osc-accent)]">{c.total}</span>
                </div>
                <div className="mono mt-0.5 flex gap-2 text-[10px] text-[var(--osc-text-faint)]">
                  <span>{c.signal_class}</span>
                  <span className={verdictClass(c.verdict)}>{c.verdict}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[12px] text-[var(--osc-text-muted)]">{c.one_liner}</div>
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
      <main className="flex flex-1 flex-col items-center justify-center bg-[var(--osc-bg)] px-6 text-center">
        <p className="text-[15px] font-medium tracking-tight text-[var(--osc-text)]">Select a candidate</p>
        <p className="mt-1.5 max-w-xs text-[13px] text-[var(--osc-text-muted)]">
          Inspect evidence, rubric scores, and paper evaluation in the detail pane.
        </p>
      </main>
    )
  }

  if (query.isLoading) {
    return <main className="flex flex-1 items-center justify-center text-[13px] text-[var(--osc-text-muted)]">Loading…</main>
  }

  if (query.isError || !query.data) {
    return (
      <main className="flex flex-1 items-center justify-center text-[13px] text-[var(--osc-error)]" role="alert">
        Candidate not found.
      </main>
    )
  }

  const c = query.data
  return (
    <main className="flex flex-1 flex-col overflow-auto bg-[var(--osc-bg)] p-6 sm:p-8">
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
        <span className="mono text-lg text-[var(--osc-accent)]">{c.total}/10</span>
        <span className={`mono text-[11px] ${verdictClass(c.verdict)}`}>{c.verdict}</span>
        <span className="mono text-[11px] text-[var(--osc-text-faint)]">class {c.signal_class}</span>
      </div>
      <p className="mb-6 text-[14px] text-[var(--osc-text-muted)]">{c.one_liner}</p>

      <section className="mb-6">
        <h2 className="mb-2 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Problem</h2>
        <p className="text-[14px] leading-relaxed">{c.problem}</p>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4">
          <h2 className="mb-1 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Buyer</h2>
          <p className="text-[13px]">{c.buyer}</p>
        </div>
        <div className="rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4">
          <h2 className="mb-1 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Shelf</h2>
          <p className="text-[13px]">{c.shelf}</p>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Evidence</h2>
        <ul className="space-y-2">
          {c.evidence.map((e) => {
            const href = safeHref(e.url)
            return (
              <li
                key={e.url}
                className="rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4 shadow-[var(--osc-shadow)]"
              >
                {href ? (
                  <a
                    className="mono text-[12px] text-[var(--osc-accent)] underline-offset-2 hover:underline"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {e.url}
                  </a>
                ) : (
                  <span className="mono text-[12px] text-[var(--osc-text-muted)]">{e.url}</span>
                )}
                <p className="mt-1.5 text-[13px] text-[var(--osc-text-muted)]">{e.summary}</p>
                <div className="mono mt-1.5 flex gap-3 text-[10px] text-[var(--osc-text-faint)]">
                  {e.date ? <span>{e.date}</span> : null}
                  {e.engagement ? <span>{e.engagement}</span> : null}
                </div>
              </li>
            )
          })}
        </ul>
        {c.verify_summary ? (
          <p className="mt-3 text-[13px] text-[var(--osc-text-muted)]">
            <span className="text-[var(--osc-text-faint)]">Verify · </span>
            {c.verify_summary}
          </p>
        ) : null}
      </section>

      {c.evaluation ? (
        <section className="mb-6">
          <h2 className="mb-2 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">
            Paper evaluation
          </h2>
          <dl className="space-y-3 rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4 text-[13px]">
            <div>
              <dt className="text-[var(--osc-text-faint)]">Pros</dt>
              <dd className="mt-0.5">{c.evaluation.pros}</dd>
            </div>
            <div>
              <dt className="text-[var(--osc-text-faint)]">Cons</dt>
              <dd className="mt-0.5">{c.evaluation.cons}</dd>
            </div>
            <div>
              <dt className="text-[var(--osc-text-faint)]">Risks</dt>
              <dd className="mt-0.5">{c.evaluation.risks}</dd>
            </div>
            <div>
              <dt className="text-[var(--osc-text-faint)]">Recommendation</dt>
              <dd className="mt-0.5">{c.evaluation.recommendation}</dd>
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
    <aside className="hidden w-60 shrink-0 overflow-auto border-l border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] md:block">
      <div className="border-b border-[var(--osc-border)] px-4 py-3 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">
        Inspector
      </div>
      <dl className="space-y-4 p-4 text-[13px]">
        <div>
          <dt className="text-[11px] text-[var(--osc-text-faint)]">Total</dt>
          <dd className="mono mt-0.5 text-[var(--osc-accent)]">{entry ? `${entry.total}/10` : "—"}</dd>
        </div>
        {r
          ? (["pain", "payment", "shelf", "freshness", "fit"] as const).map((key) => (
              <div key={key}>
                <dt className="text-[11px] text-[var(--osc-text-faint)]">{key}</dt>
                <dd className="mono mt-0.5">{r[key]}</dd>
              </div>
            ))
          : null}
        <div>
          <dt className="text-[11px] text-[var(--osc-text-faint)]">Batch</dt>
          <dd className="mono mt-0.5 text-[12px]">{entry?.batch ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-[var(--osc-text-faint)]">First seen</dt>
          <dd className="mono mt-0.5 text-[12px]">{entry?.first_seen ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-[var(--osc-text-faint)]">Status</dt>
          <dd className="mono mt-0.5 text-[12px]">{entry?.status ?? "—"}</dd>
        </div>
      </dl>
    </aside>
  )
}

function StatusStrip({ count, label }: { count: number; label: string }) {
  return (
    <footer className="flex h-8 shrink-0 items-center border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-4 text-[11px] text-[var(--osc-text-faint)]">
      <span className="mono">
        {count} {label}
      </span>
      <span className="mx-2">·</span>
      <span>Read-only companion</span>
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
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--osc-border)] bg-[var(--osc-bg)] px-4 py-2 text-[12px]">
      <label className="flex items-center gap-1.5 text-[var(--osc-text-muted)]">
        Class
        <select
          className="rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-2 py-1 text-[var(--osc-text)]"
          value={signalClass}
          onChange={(e) => set("signalClass", e.target.value)}
        >
          <option value="">all</option>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[var(--osc-text-muted)]">
        Verdict
        <select
          className="rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-2 py-1 text-[var(--osc-text)]"
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
    <div className="flex min-h-0 flex-1 flex-col" data-studio="startup">
      <SubNav active="pool" />
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
  const rejectsQuery = useQuery({
    queryKey: ["startup", "rejects"],
    queryFn: async () => (await fetchJson<{ rejects: RejectSummary[] }>(api("/rejects"))).rejects,
  })
  const rejects = rejectsQuery.data ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-studio="startup">
      <SubNav active="rejects" />
      <main className="flex-1 overflow-auto p-6 sm:p-8">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Rejects</h1>
        <p className="mb-6 text-[13px] text-[var(--osc-text-muted)]">Ideas that did not clear the bar.</p>
        {rejects.length === 0 ? (
          <div className="rounded-[var(--osc-radius-lg)] border border-dashed border-[var(--osc-border-strong)] px-6 py-16 text-center">
            <p className="text-[14px] font-medium text-[var(--osc-text)]">No rejects</p>
            <p className="mt-1 text-[13px] text-[var(--osc-text-muted)]">Rejected candidates will list here.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rejects.map((r) => (
              <li
                key={r.name}
                className="rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4 shadow-[var(--osc-shadow)]"
              >
                <div className="mono text-[13px] font-medium">{r.name}</div>
                <p className="mt-1 text-[13px] text-[var(--osc-text-muted)]">{r.problem}</p>
                <p className="mt-1.5 text-[12px] text-[var(--osc-error)]">{r.reason}</p>
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
          <div className="flex min-h-0 flex-1 items-center justify-center text-[var(--osc-error)]" role="alert">
            Route not found.
          </div>
        }
      />
    </Routes>
  )
}
