import { fetchJson } from "@ui/lib/fetch-json"
import { apiBase as runtimeApiBase } from "@ui/studio-context"

export { studioHref } from "@ui/studio-context"

function apiPath(path: string) {
  const base = runtimeApiBase("/api/studios/pcb").replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export type ProjectSummary = {
  id: string
  name: string
  path: string
  directory: string
  built: boolean
  artifactStatus: "missing" | "fresh" | "stale"
  artifactError: string | null
  hasSchematicSvg: boolean
  hasPcbSvg: boolean
  hasGerbersZip: boolean
  designValid: boolean | null
  fabricationReady: boolean | null
  assemblyReady: boolean | null
  errorCount: number | null
  warningCount: number | null
}

export type DiagnosticGroup = {
  type: string
  count: number
  messages: string[]
}

export type CircuitDiagnostics = {
  designValid: boolean
  errorCount: number
  warningCount: number
  errors: DiagnosticGroup[]
  warnings: DiagnosticGroup[]
}

export type ProjectDetail = ProjectSummary & {
  diagnostics: CircuitDiagnostics | null
}

export type PartSummary = {
  mpn: string
  manufacturer: string | null
  description: string | null
  category: string | null
  datasheet: string | null
  hasSpiceModel: boolean
}

export type CatalogPartDetail = {
  mpn: string
  manufacturer?: string
  description?: string
  category?: string
  datasheet?: string
  spiceModel?: {
    sourceUrl: string
    subcircuit: string
    pins: string[]
    pinMapping: Record<string, string>
    sha256: string
  }
  [key: string]: unknown
}

export type CatalogPartResponse = {
  part: CatalogPartDetail
}

export type ProjectsResponse = {
  projects: ProjectSummary[]
  total: number
  hasMore: boolean
}

export type CatalogResponse = {
  parts: PartSummary[]
  total: number
}

export type BomEntry = {
  mpn: string | null
  supplierPartNumbers: Record<string, string[]>
  refdes: string[]
  quantity: number
  manufacturer: string | null
  description: string | null
  datasheet: string | null
  category: string | null
  inCatalog: boolean
}

export type CatalogUpsertBody = {
  manufacturer?: string | null
  description?: string | null
  datasheet?: string | null
  category?: string | null
  replace?: boolean
}

export type CatalogUpsertResponse = {
  created: boolean
  path: string
  part: CatalogPartDetail
}

async function fetchJsonWithCsrf<T>(url: string, init?: RequestInit): Promise<T> {
  const csrf = await fetchJson<{ token: string }>("/api/csrf")
  return fetchJson<T>(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrf.token,
      ...(init?.headers ?? {}),
    },
  })
}

export type BomResponse = {
  projectId: string
  name: string
  fabricationReady: boolean
  assemblyReady: boolean
  bomComplete: boolean
  entries: BomEntry[]
  totalComponents: number
  listedCount: number
  unlistedCount: number
}

export type WorkspaceInfo = {
  root: string
  path?: string
  directory?: string
}

export type SimulationSeries = {
  name: string
  kind: "voltage" | "current"
  unit: "V" | "A"
  values: number[]
  summary: {
    first: number
    last: number
    min: number
    max: number
    mean: number
    peakToPeak: number
  }
}

export type SimulationExperiment = {
  id: string
  name: string
  analysis: "transient"
  pointsCount: number
  returnedPoints: number
  downsampled: boolean
  axis: { name: "time"; unit: "ms"; values: number[] }
  series: SimulationSeries[]
}

export type SimulationResponse = {
  projectId: string
  name: string
  simulationSuccess: boolean
  experiments: SimulationExperiment[]
  diagnostics?: string[]
}

export const api = {
  workspace: (projectId?: string): Promise<WorkspaceInfo> => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
    return fetchJson(apiPath(`/workspace${query}`))
  },

  projects: (params?: { all?: boolean; limit?: number; offset?: number }): Promise<ProjectsResponse> => {
    const q = new URLSearchParams()
    if (params?.all) q.set("all", "1")
    if (params?.limit !== undefined) q.set("limit", String(params.limit))
    if (params?.offset !== undefined) q.set("offset", String(params.offset))
    return fetchJson(apiPath(`/projects?${q}`))
  },

  project: (id: string): Promise<ProjectDetail> => fetchJson(apiPath(`/projects/${encodeURIComponent(id)}`)),

  catalog: (query?: string): Promise<CatalogResponse> => {
    const q = new URLSearchParams()
    if (query) q.set("q", query)
    return fetchJson(apiPath(`/catalog?${q}`))
  },

  catalogPart: (mpn: string): Promise<CatalogPartResponse> => fetchJson(apiPath(`/catalog/${encodeURIComponent(mpn)}`)),

  catalogUpsert: (mpn: string, body: CatalogUpsertBody = {}): Promise<CatalogUpsertResponse> =>
    fetchJsonWithCsrf(apiPath(`/catalog/${encodeURIComponent(mpn)}`), {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  schematicSvgUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/schematic.svg`),
  pcbSvgUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/pcb.svg`),
  gerbersZipUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/gerbers.zip`),
  circuitJsonUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/circuit.json`),
  bom: (id: string): Promise<BomResponse> => fetchJson(apiPath(`/projects/${encodeURIComponent(id)}/bom`)),
  simulation: (id: string, maxPoints = 500): Promise<SimulationResponse> =>
    fetchJson(apiPath(`/projects/${encodeURIComponent(id)}/simulation?maxPoints=${maxPoints}`)),
  bomCsvUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/bom.csv`),
  assemblyCsvUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/assembly.csv`),
  eventsUrl: () => apiPath("/events"),
}
