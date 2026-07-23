function apiBase() {
  return (window as any).__OPENCODE_STUDIO__?.apiBase ?? "/api/studios/media"
}

function api(path: string) {
  return `${apiBase().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
}

export function studioHref(path = "") {
  const runtime = (window as any).__OPENCODE_STUDIO__ as { uiBase?: string } | undefined
  const base = (runtime?.uiBase ?? "").replace(/\/$/, "")
  const suffix = path.replace(/^\//, "")
  if (!base) return suffix ? `/${suffix}` : "/"
  return suffix ? `${base}/${suffix}` : base
}

export type Modality = "image" | "audio" | "video"
export type LibraryScope = "personal" | "shared"

export type Asset = {
  ref: string
  path: string
  scope: LibraryScope
  user: string | null
  modality: Modality
  mime: string
  bytes: number
  modifiedAt: string
  mediaUrl: string
  downloadUrl: string
}

export type Folder = {
  path: string
  scope: LibraryScope
  user: string | null
  modality: Modality
  name: string
  subfolder: string
}

export type AssetList = {
  assets: Asset[]
  folders?: Folder[]
  hasMore: boolean
  currentUser?: string | null
}

async function request<T>(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string | { message?: string } } | null
    const message = typeof body?.error === "string" ? body.error : body?.error?.message ?? `Request failed: ${response.status}`
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export function listAssets(
  filters: {
    scope?: LibraryScope
    user?: string
    modality?: Modality
    filename?: string
    folder?: string
    limit?: number
    offset?: number
  } = {},
) {
  const query = new URLSearchParams()
  if (filters.scope) query.set("scope", filters.scope)
  if (filters.user) query.set("user", filters.user)
  if (filters.modality) query.set("modality", filters.modality)
  if (filters.filename) query.set("filename", filters.filename)
  if (filters.folder !== undefined) query.set("folder", filters.folder)
  if (filters.limit !== undefined) query.set("limit", String(filters.limit))
  if (filters.offset !== undefined) query.set("offset", String(filters.offset))
  return request<AssetList>(api(`/assets${query.size ? `?${query}` : ""}`))
}

export function getAsset(ref: string) {
  return request<Asset>(api(`/assets/${encodeURIComponent(ref)}`))
}

export function getHealth() {
  return request<{ status: string }>("/api/health")
}

export type VersionInfo = {
  running: string
  installed?: string
  latest?: string | null
  updateAvailable?: boolean
  restartRequired?: boolean
  updateCommand?: string
}

export function getVersion(): Promise<VersionInfo> {
  return request<{ packageVersion: string }>("/api/studios").then((body) => ({
    running: body.packageVersion,
    installed: body.packageVersion,
    latest: null,
    updateAvailable: false,
    restartRequired: false,
    updateCommand: "opencode-studio configure",
  }))
}

export type StudioInfo = {
  id: string
  packageVersion: string
  contractVersion?: string
}

export function getStudio() {
  return getVersion().then((v) => ({ id: "media", packageVersion: v.running }))
}
