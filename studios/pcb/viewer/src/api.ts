function apiBase() {
  return (window as any).__OPENCODE_STUDIO__?.apiBase ?? "/api/studios/pcb"
}

function apiPath(path: string) {
  return `${apiBase().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
}

export function studioHref(path = "") {
  const runtime = (window as any).__OPENCODE_STUDIO__ as { uiBase?: string } | undefined
  const base = (runtime?.uiBase ?? "").replace(/\/$/, "")
  const suffix = path.replace(/^\//, "")
  if (!base) return suffix ? `/${suffix}` : "/"
  return suffix ? `${base}/${suffix}` : base
}

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
  workspace: (): Promise<WorkspaceInfo> => apiFetch(apiPath("/workspace")),

  projects: (params?: { limit?: number; offset?: number }): Promise<ProjectsResponse> => {
    const q = new URLSearchParams()
    if (params?.limit !== undefined) q.set("limit", String(params.limit))
    if (params?.offset !== undefined) q.set("offset", String(params.offset))
    return apiFetch(apiPath(`/projects?${q}`))
  },

  project: (id: string): Promise<ProjectDetail> => apiFetch(apiPath(`/projects/${encodeURIComponent(id)}`)),

  catalog: (query?: string): Promise<CatalogResponse> => {
    const q = new URLSearchParams()
    if (query) q.set("q", query)
    return apiFetch(apiPath(`/catalog?${q}`))
  },

  catalogPart: (mpn: string): Promise<Record<string, unknown>> => apiFetch(apiPath(`/catalog/${encodeURIComponent(mpn)}`)),

  schematicSvgUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/schematic.svg`),
  pcbSvgUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/pcb.svg`),
  gerbersZipUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/gerbers.zip`),
  circuitJsonUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/circuit.json`),
  bom: (id: string): Promise<BomResponse> => apiFetch(apiPath(`/projects/${encodeURIComponent(id)}/bom`)),
  bomCsvUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/bom.csv`),
  assemblyCsvUrl: (id: string) => apiPath(`/projects/${encodeURIComponent(id)}/assembly.csv`),
  eventsUrl: () => apiPath("/events"),
}
