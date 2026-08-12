import { fetchJson } from "@ui/lib/fetch-json"
import { apiBase as runtimeApiBase, studioHref } from "@ui/studio-context"

export { studioHref }

function api(path: string) {
  const base = runtimeApiBase("/api/studios/fw").replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export type FwCapability = "uart" | "gpio" | "wifi" | "ble" | "thread"

export type FwProjectSummary = {
  id: string
  path: string
  directory: string
  chip: string
  engine: string
  capabilities: FwCapability[]
  buildOk: boolean | null
  runOk: boolean | null
}

export type FwBuildRecord = {
  ok: boolean
  finishedAt: string
  exitCode: number | null
  logPath: string
}

export type FwRunRecord = {
  ok: boolean
  reason: "expect" | "fail" | "timeout" | "exit" | "abort"
  engine: string
  chip: string
  expect?: string
  fail?: string
  matched?: string
  durationMs: number
  finishedAt: string
  exitCode: number | null
  logPath: string
}

export type FwProjectDetail = FwProjectSummary & {
  name: string
  build: FwBuildRecord | null
  run: FwRunRecord | null
  uart: string
  buildLog: string
}

export async function listProjects() {
  const result = await fetchJson<{ projects: FwProjectSummary[] }>(api("/projects"))
  return result.projects
}

export function readWorkspace(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
  return fetchJson<{ root: string; path?: string; directory?: string }>(api(`/workspace${query}`))
}

export function readProject(id: string) {
  return fetchJson<FwProjectDetail>(api(`/projects/${encodeURIComponent(id)}`))
}

export function eventsUrl() {
  return api("/events")
}
