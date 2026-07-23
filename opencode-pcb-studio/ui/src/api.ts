export type ProjectSummary = {
  id: string
  name: string
  path: string
  built: boolean
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
  refdes: string[]
  quantity: number
  manufacturer: string | null
  description: string | null
  datasheet: string | null
  category: string | null
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
  projectCount: number
}

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as any).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  workspace: (): Promise<WorkspaceInfo> => apiFetch("/api/workspace"),

  projects: (params?: { limit?: number; offset?: number }): Promise<ProjectsResponse> => {
    const q = new URLSearchParams()
    if (params?.limit !== undefined) q.set("limit", String(params.limit))
    if (params?.offset !== undefined) q.set("offset", String(params.offset))
    return apiFetch(`/api/projects?${q}`)
  },

  project: (id: string): Promise<ProjectDetail> => apiFetch(`/api/projects/${encodeURIComponent(id)}`),

  catalog: (query?: string): Promise<CatalogResponse> => {
    const q = new URLSearchParams()
    if (query) q.set("q", query)
    return apiFetch(`/api/catalog?${q}`)
  },

  catalogPart: (mpn: string): Promise<Record<string, unknown>> => apiFetch(`/api/catalog/${encodeURIComponent(mpn)}`),

  schematicSvgUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/schematic.svg`,
  pcbSvgUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/pcb.svg`,
  gerbersZipUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/gerbers.zip`,
  circuitJsonUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/circuit.json`,
  bom: (id: string): Promise<BomResponse> => apiFetch(`/api/projects/${encodeURIComponent(id)}/bom`),
  bomCsvUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/bom.csv`,
  assemblyCsvUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/assembly.csv`,
}
