const API = "/api"

export type DesignSummary = {
  id: string
  directory: string
  buildStatus: "built" | "unbuilt" | "stale"
  partCount: number
  revision: string | null
  renderRevision: string | null
}

export type ArtifactPart = {
  id: string
  files: { step: string; stl: string; glb: string }
  metrics: {
    volume_mm3: number
    size_mm: { x: number; y: number; z: number }
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
  } | null
  renders: string[]
}

export type StudioInfo = {
  id: string
  packageVersion: string
  contractVersion: string
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const response = await fetch(`${API}/designs`)
  if (!response.ok) throw new Error(`listDesigns failed: ${response.status}`)
  const data = (await response.json()) as { designs?: DesignSummary[] }
  return data.designs ?? []
}

export async function readDesign(id: string): Promise<DesignDetail> {
  const response = await fetch(`${API}/designs/${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error(`readDesign failed: ${response.status}`)
  return response.json() as Promise<DesignDetail>
}

export async function fetchStudio(): Promise<StudioInfo> {
  const response = await fetch(`${API}/studio`)
  if (!response.ok) throw new Error(`fetchStudio failed: ${response.status}`)
  return response.json() as Promise<StudioInfo>
}

export function artifactUrl(designId: string, file: string) {
  return `${API}/artifact?design=${encodeURIComponent(designId)}&file=${encodeURIComponent(file)}`
}

export function renderUrl(designId: string, file: string) {
  return `${API}/render?design=${encodeURIComponent(designId)}&file=${encodeURIComponent(file)}`
}
