import { fetchJson } from "@ui/lib/fetch-json"
import { apiBase as runtimeApiBase, studioHref } from "@ui/studio-context"

export { studioHref }

function api(path: string) {
  const base = runtimeApiBase("/api/studios/media").replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export type MediaProject = { id: string; path: string; directory: string }

export async function listProjects() {
  const result = await fetchJson<{ projects: MediaProject[] }>(api("/projects"))
  return result.projects
}

export function readWorkspace(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
  return fetchJson<{ root: string; path?: string; directory?: string }>(api(`/workspace${query}`))
}

export function readProject(id: string) {
  return fetchJson<MediaProject>(api(`/projects/${encodeURIComponent(id)}`))
}

export function projectFilesBase(id: string) {
  return api(`/projects/${encodeURIComponent(id)}/files`)
}
