import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Link, Navigate, Route, Routes, useParams } from "react-router"
import { claimAgentContext } from "@ui/agent-context"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Badge } from "@ui/components/badge"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { StudioHomeHeader } from "@ui/components/studio-home"
import { StudioShell } from "@ui/components/studio-shell"
import {
  type ConceptDetail,
  eventsUrl,
  listConcepts,
  moodboardUrl,
  readConcept,
  readWorkspace,
  studioHref,
} from "./api"

function useConceptEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const es = new EventSource(eventsUrl())
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as { type?: string; conceptId?: string }
        if (event.type === "concepts-changed") void queryClient.invalidateQueries({ queryKey: ["concept", "list"] })
        if (event.type === "artifacts-changed") {
          void queryClient.invalidateQueries({ queryKey: ["concept", "list"] })
          if (event.conceptId) void queryClient.invalidateQueries({ queryKey: ["concept", event.conceptId] })
        }
      } catch {
        // ignore
      }
    }
    return () => es.close()
  }, [queryClient])
}

function ConceptsPage() {
  useConceptEvents()
  const concepts = useQuery({ queryKey: ["concept", "list"], queryFn: listConcepts })
  const workspace = useQuery({ queryKey: ["concept", "workspace"], queryFn: () => readWorkspace() })

  useEffect(() => {
    if (!workspace.data?.root) return
    return claimAgentContext("concept-root", {
      key: "concept-root",
      kind: "concept-root",
      studioId: "concept",
      label: "Concept Studio",
      directory: workspace.data.root,
      historicalDirectory: workspace.data.root,
      status: "available",
    })
  }, [workspace.data?.root])

  return (
    <StudioShell studioId="concept" label="Concept">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <StudioHomeHeader
          eyebrow="Concept Studio"
          title="Concepts"
          count={concepts.data ? `${concepts.data.length} concept${concepts.data.length === 1 ? "" : "s"}` : undefined}
        />
        {concepts.isLoading ? <div className="osc-skeleton h-24 w-full" role="status" aria-label="Loading concepts" /> : null}
        {concepts.error ? <ErrorState title="Failed to load concepts" description={String(concepts.error)} /> : null}
        {concepts.data?.length === 0 ? (
          <EmptyState
            title="No concepts yet"
            description="Ask the Concept agent to start from a product seed with concept_create."
            action={
              <button
                type="button"
                className="osc-chip"
                onClick={() =>
                  requestAgentHandoff({
                    text: "Create a new Concept Studio project with concept_create and interview me only for blockers.",
                    source: "concept",
                    open: true,
                  })
                }
              >
                Draft concept request
              </button>
            }
          />
        ) : null}
        {concepts.data?.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {concepts.data.map((item) => (
              <Link key={item.id} to={studioHref(`concepts/${encodeURIComponent(item.id)}`)} className="concept-card">
                <span className="concept-card__rail" aria-hidden />
                {item.thumb ? (
                  <img className="concept-thumb mb-3" src={moodboardUrl(item.id, fileName(item.thumb))} alt="" />
                ) : null}
                <p className="truncate text-[14px] font-semibold">{item.id}</p>
                <p className="mt-1 line-clamp-2 text-[12px] text-[var(--osc-text-muted)]">{item.one_liner ?? "No intent yet"}</p>
                <div className="mt-3">
                  <Badge tone={item.status === "frozen" ? "ok" : "neutral"} dot>
                    {item.status}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </StudioShell>
  )
}

function ConceptPage() {
  useConceptEvents()
  const { id } = useParams()
  const conceptId = id ?? ""
  const detail = useQuery({
    queryKey: ["concept", conceptId],
    queryFn: () => readConcept(conceptId),
    enabled: Boolean(conceptId),
  })

  useEffect(() => {
    if (!detail.data?.directory) return
    return claimAgentContext(`concept-${conceptId}`, {
      key: `concept:${conceptId}`,
      kind: "concept-project",
      studioId: "concept",
      projectId: conceptId,
      relativePath: conceptId,
      label: `Concept · ${conceptId}`,
      directory: detail.data.directory,
      historicalDirectory: detail.data.directory,
      status: "available",
    })
  }, [conceptId, detail.data?.directory])

  if (detail.isLoading) {
    return (
      <StudioShell studioId="concept" label="Concept">
        <div className="osc-skeleton m-8 h-40" role="status" aria-label="Loading concept" />
      </StudioShell>
    )
  }
  if (detail.error || !detail.data) {
    return (
      <StudioShell studioId="concept" label="Concept">
        <ErrorState className="m-8" title="Concept not found" description={String(detail.error ?? "missing")} />
      </StudioShell>
    )
  }
  return (
    <StudioShell studioId="concept" label="Concept">
      <ConceptDetailView detail={detail.data} />
    </StudioShell>
  )
}

function ConceptDetailView({ detail }: { detail: ConceptDetail }) {
  const concept = detail.concept
  const chosen = concept.directions.find((item) => item.id === concept.chosen_direction)
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Concept</p>
          <h1 className="text-xl font-semibold tracking-tight">{concept.intent?.product_type ?? concept.id}</h1>
          <p className="mt-1 text-[13px] text-[var(--osc-text-muted)]">{concept.intent?.one_liner ?? "No one-liner yet"}</p>
        </div>
        <Badge tone={concept.status === "frozen" ? "ok" : "neutral"} dot>
          {concept.status}
        </Badge>
      </div>

      <section className="concept-section">
        <h2>Context</h2>
        {concept.context ? (
          <ul className="space-y-1 text-[13px]">
            <li>User: {concept.context.user}</li>
            <li>Environment: {concept.context.environment}</li>
            {concept.context.scenarios.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--osc-text-muted)]">Not set</p>
        )}
      </section>

      <section className="concept-section">
        <h2>Constraints</h2>
        {concept.constraints ? (
          <ul className="space-y-1 text-[13px]">
            <li>Envelope: {concept.constraints.envelope_mm ? `${concept.constraints.envelope_mm.join(" × ")} mm` : "—"}</li>
            <li>Process: {concept.constraints.process ?? "—"}</li>
            <li>Cost: {concept.constraints.cost ?? "—"}</li>
            <li>Brand: {concept.constraints.brand ?? "—"}</li>
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--osc-text-muted)]">Not set</p>
        )}
      </section>

      <section className="concept-section">
        <h2>Must</h2>
        {concept.requirements?.must.length ? (
          <ul className="space-y-1 text-[13px]">
            {concept.requirements.must.map((item) => (
              <li key={item.id}>
                <span className="font-mono text-[12px]">{item.id}</span> {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--osc-text-muted)]">None yet</p>
        )}
      </section>

      <section className="concept-section">
        <h2>Direction</h2>
        {chosen ? (
          <div className="space-y-2 text-[13px]">
            <p className="font-semibold">{chosen.name}</p>
            <p>{chosen.form}</p>
            <p className="text-[var(--osc-text-muted)]">CMF: {chosen.cmf}</p>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--osc-text-muted)]">No direction chosen</p>
        )}
      </section>

      <section className="concept-section">
        <h2>Moodboards</h2>
        {concept.moodboards.length ? (
          <div className="concept-grid">
            {concept.moodboards.map((item) => (
              <img key={item.path} className="concept-thumb" src={moodboardUrl(detail.id, fileName(item.path))} alt={item.direction_id} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--osc-text-muted)]">None yet</p>
        )}
      </section>

      <section className="concept-section">
        <h2>Review</h2>
        {detail.review ? (
          detail.review.findings.length ? (
            <ul className="space-y-2 text-[13px]">
              {detail.review.findings.map((item) => (
                <li key={item.id}>
                  <Badge tone={item.severity === "blocker" ? "fail" : item.severity === "weak" ? "warn" : "neutral"}>{item.severity}</Badge>{" "}
                  <span className="font-medium">{item.topic}</span> — {item.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--osc-text-muted)]">Clean pass</p>
          )
        ) : (
          <p className="text-[13px] text-[var(--osc-text-muted)]">No review yet</p>
        )}
      </section>

      {detail.brief ? (
        <section className="concept-section">
          <h2>Brief</h2>
          <pre className="concept-brief">{detail.brief}</pre>
        </section>
      ) : null}
    </div>
  )
}

function fileName(relative: string) {
  return relative.replaceAll("\\", "/").split("/").at(-1) ?? relative
}

export function App() {
  return (
    <Routes>
      <Route index element={<ConceptsPage />} />
      <Route path="concepts/:id" element={<ConceptPage />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  )
}
