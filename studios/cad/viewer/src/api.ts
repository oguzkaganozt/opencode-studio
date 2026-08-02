import { apiBase as runtimeApiBase, studioHref as runtimeStudioHref } from "@ui/studio-context"

function api(path: string) {
  const base = runtimeApiBase("/api/studios/cad").replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export function studioHref(path = "") {
  return runtimeStudioHref(path)
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

export type StudioInfo = {
  id: string
  packageVersion: string
  contractVersion?: string
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const response = await fetch(api("/designs"))
  if (!response.ok) throw new Error(`listDesigns failed: ${response.status}`)
  const data = (await response.json()) as { designs?: DesignSummary[] }
  return data.designs ?? []
}

export async function readDesign(id: string): Promise<DesignDetail> {
  const response = await fetch(api(`/designs/${encodeURIComponent(id)}`))
  if (!response.ok) throw new Error(`readDesign failed: ${response.status}`)
  return response.json() as Promise<DesignDetail>
}

export async function fetchStudio(): Promise<StudioInfo> {
  const response = await fetch("/api/studios")
  if (!response.ok) throw new Error(`fetchStudio failed: ${response.status}`)
  const body = (await response.json()) as { packageVersion?: string; enabled?: string[] }
  return { id: "cad", packageVersion: body.packageVersion ?? "0.0.0" }
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
