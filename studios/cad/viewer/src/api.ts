import { fetchJson } from "@ui/lib/fetch-json"
import { apiBase as runtimeApiBase } from "@ui/studio-context"

export { studioHref } from "@ui/studio-context"

function api(path: string) {
  const base = runtimeApiBase("/api/studios/cad").replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export type DesignSummary = {
  id: string
  directory: string
  absoluteDirectory: string
  buildStatus: "built" | "unbuilt" | "stale"
  partCount: number
  revision: string | null
  renderRevision: string | null
}

export type ArtifactPart = {
  id: string
  files: { step: string; stl: string; glb: string; topo?: string }
  metrics: {
    volume_mm3: number
    size_mm: { x: number; y: number; z: number }
    face_count?: number
  }
}

export type DesignDetail = DesignSummary & {
  design: {
    schema: number
    id: string
    params?: string
    parts: Array<{ id: string; source: string }>
  }
  artifact: {
    schema: number
    id: string
    parts: ArtifactPart[]
    build?: { engine: string; inputs: Record<string, string> }
  } | null
  renders: string[]
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const data = await fetchJson<{ designs?: DesignSummary[] }>(api("/designs"))
  return data.designs ?? []
}

export async function readDesign(id: string): Promise<DesignDetail> {
  return fetchJson<DesignDetail>(api(`/designs/${encodeURIComponent(id)}`))
}

export function artifactUrl(designId: string, file: string) {
  return api(`/artifact?design=${encodeURIComponent(designId)}&file=${encodeURIComponent(file)}`)
}

export function renderUrl(designId: string, file: string) {
  return api(`/render?design=${encodeURIComponent(designId)}&file=${encodeURIComponent(file)}`)
}

export function eventsUrl() {
  return api("/events")
}
