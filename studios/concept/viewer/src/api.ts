import { fetchJson } from "@ui/lib/fetch-json"
import { apiBase as runtimeApiBase, studioHref } from "@ui/studio-context"

export { studioHref }

function api(path: string) {
  const base = runtimeApiBase("/api/studios/concept").replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export type ConceptSummary = {
  id: string
  directory: string
  status: "draft" | "frozen"
  one_liner: string | null
  product_type: string | null
  thumb: string | null
}

export type ConceptDetail = {
  id: string
  directory: string
  concept: {
    id: string
    status: "draft" | "frozen"
    revision: number
    intent: { one_liner: string; product_type: string } | null
    context: { user: string; environment: string; scenarios: string[] } | null
    constraints: {
      envelope_mm: [number, number, number] | null
      cost: string | null
      process: string | null
      brand: string | null
      other: string[]
    } | null
    requirements: {
      must: Array<{ id: string; text: string }>
      should: Array<{ id: string; text: string }>
      could: Array<{ id: string; text: string }>
      out: string[]
    } | null
    directions: Array<{ id: string; name: string; form: string; cmf: string; rationale: string }>
    chosen_direction: string | null
    moodboards: Array<{ path: string; direction_id: string; prompt_hash: string; provider: string }>
    frozen_at: string | null
  }
  review: {
    findings: Array<{ id: string; severity: "blocker" | "weak" | "note"; topic: string; text: string }>
  } | null
  brief: string | null
}

export async function listConcepts() {
  const result = await fetchJson<{ concepts: ConceptSummary[] }>(api("/concepts"))
  return result.concepts
}

export function readWorkspace(conceptId?: string) {
  const query = conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : ""
  return fetchJson<{ root: string; path?: string; directory?: string }>(api(`/workspace${query}`))
}

export function readConcept(id: string) {
  return fetchJson<ConceptDetail>(api(`/concepts/${encodeURIComponent(id)}`))
}

export function moodboardUrl(id: string, file: string) {
  return api(`/concepts/${encodeURIComponent(id)}/moodboards/${encodeURIComponent(file)}`)
}

export function eventsUrl() {
  return api("/events")
}
