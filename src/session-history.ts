import { stat } from "node:fs/promises"
import path from "node:path"
import type { GlobalSession } from "@opencode-ai/sdk/v2/client"
import { isInside } from "./core/paths"
import {
  STUDIO_SESSION_METADATA_KEY,
  type StudioSessionContext,
  type StudioSessionContextKind,
  type StudioSessionHistoryItem,
  type StudioSessionHistoryResponse,
  type StudioSessionMetadata,
} from "./core/session-history"
import { openCodeBasicAuthHeaders } from "./opencode-bridge"

export type GlobalSessionSource = (input: { limit: number }) => Promise<GlobalSession[]>

export class SessionHistoryInputError extends Error {}

type StudioRoots = {
  home: string
  cad: string | null
  pcb: string | null
}

function absolute(raw: string): string {
  return path.resolve(raw)
}

function safeRelative(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!normalized || normalized.split("/").some((part) => part === ".." || !part)) return undefined
  return normalized
}

function parseMetadata(session: GlobalSession): StudioSessionMetadata | undefined {
  const raw = session.metadata?.[STUDIO_SESSION_METADATA_KEY]
  if (!raw || typeof raw !== "object") return undefined
  const value = raw as Partial<StudioSessionMetadata>
  const kinds: StudioSessionContextKind[] = ["home", "cad-root", "cad-project", "pcb-root", "pcb-project"]
  if (value.schema !== 1 || typeof value.key !== "string" || typeof value.label !== "string" || !kinds.includes(value.kind!))
    return undefined
  if ((value.kind === "cad-root" || value.kind === "cad-project") && value.studioId !== "cad") return undefined
  if ((value.kind === "pcb-root" || value.kind === "pcb-project") && value.studioId !== "pcb") return undefined
  if (
    (value.kind === "cad-project" || value.kind === "pcb-project") &&
    (typeof value.projectId !== "string" || !value.projectId || !safeRelative(value.relativePath))
  )
    return undefined
  if (value.kind === "cad-project" && safeRelative(value.relativePath) === ".") return undefined
  if ((value.kind === "home" || value.kind === "cad-root" || value.kind === "pcb-root") && value.relativePath !== undefined)
    return undefined
  return value as StudioSessionMetadata
}

async function pathMatches(candidate: string, kind: "directory" | "file"): Promise<boolean> {
  try {
    const info = await stat(candidate)
    return kind === "directory" ? info.isDirectory() : info.isFile()
  } catch {
    return false
  }
}

function contextMarker(context: Omit<StudioSessionContext, "status">): { path: string; kind: "directory" | "file" } {
  if (context.kind === "cad-project") return { path: path.join(context.directory, "design.json"), kind: "file" }
  if (context.kind === "pcb-project") return { path: path.join(context.directory, "src", "circuit.tsx"), kind: "file" }
  return { path: context.directory, kind: "directory" }
}

function rootForKind(kind: StudioSessionContextKind, roots: StudioRoots): string | null {
  if (kind === "home") return roots.home
  if (kind === "cad-root" || kind === "cad-project") return roots.cad
  return roots.pcb
}

function metadataContext(
  session: GlobalSession,
  metadata: StudioSessionMetadata,
  roots: StudioRoots,
): Omit<StudioSessionContext, "status"> | undefined {
  const root = rootForKind(metadata.kind, roots)
  if (!root) return undefined
  const relativePath = safeRelative(metadata.relativePath)
  const directory = relativePath ? path.resolve(root, ...relativePath.split("/")) : absolute(root)
  if (directory !== absolute(root) && !isInside(root, directory)) return undefined
  return { ...metadata, relativePath, directory, historicalDirectory: absolute(session.directory) }
}

function legacyContext(session: GlobalSession, roots: StudioRoots): Omit<StudioSessionContext, "status"> | undefined {
  const historicalDirectory = absolute(session.directory)
  if (historicalDirectory === absolute(roots.home)) {
    return { schema: 1, key: "home", kind: "home", label: "Home", directory: historicalDirectory, historicalDirectory }
  }

  for (const [studioId, root] of [
    ["cad", roots.cad],
    ["pcb", roots.pcb],
  ] as const) {
    if (!root) continue
    const resolvedRoot = absolute(root)
    if (historicalDirectory === resolvedRoot) {
      const kind = `${studioId}-root` as "cad-root" | "pcb-root"
      return {
        schema: 1,
        key: kind,
        kind,
        studioId,
        label: studioId === "cad" ? "CAD Studio" : "PCB Studio",
        directory: resolvedRoot,
        historicalDirectory,
      }
    }
    if (!isInside(resolvedRoot, historicalDirectory)) continue
    const relativePath = path.relative(resolvedRoot, historicalDirectory).split(path.sep).join("/")
    const projectId = studioId === "cad" ? relativePath.split("/")[0]! : Buffer.from(relativePath).toString("base64url")
    const kind = `${studioId}-project` as "cad-project" | "pcb-project"
    return {
      schema: 1,
      key: `${studioId}:${projectId}`,
      kind,
      studioId,
      projectId,
      relativePath,
      label: `${studioId.toUpperCase()} · ${path.basename(historicalDirectory)}`,
      directory: historicalDirectory,
      historicalDirectory,
    }
  }
  return undefined
}

async function classifySession(
  session: GlobalSession,
  roots: StudioRoots,
  exists: (context: Omit<StudioSessionContext, "status">) => Promise<boolean>,
): Promise<StudioSessionHistoryItem | undefined> {
  const base = parseMetadata(session)
  const context = base ? metadataContext(session, base, roots) : legacyContext(session, roots)
  if (!context) return undefined
  const available = await exists(context)
  const status = available ? (context.directory === context.historicalDirectory ? "available" : "moved") : "missing"
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    parentID: session.parentID,
    model: session.model,
    time: session.time,
    context: { ...context, status },
  }
}

export function createGlobalSessionSource(baseUrl: string, env: NodeJS.ProcessEnv = process.env): GlobalSessionSource {
  return async ({ limit }) => {
    const url = new URL("/experimental/session", baseUrl)
    url.searchParams.set("roots", "true")
    url.searchParams.set("limit", String(limit))
    const response = await fetch(url, { headers: openCodeBasicAuthHeaders(env) })
    if (!response.ok) throw new Error(`OpenCode session history HTTP ${response.status}`)
    const rows = (await response.json()) as unknown
    if (!Array.isArray(rows)) throw new Error("Invalid OpenCode session history response")
    return rows as GlobalSession[]
  }
}

/** Default cap on OpenCode global session fetch for agent history. */
export const DEFAULT_SESSION_HISTORY_LIMIT = 500

export async function studioSessionHistory(input: {
  source: GlobalSessionSource
  roots: StudioRoots
  scope: "studio" | "directory"
  directory?: string
  contextKey?: string
  search?: string
  /** OpenCode session list limit (default DEFAULT_SESSION_HISTORY_LIMIT). */
  limit?: number
}): Promise<StudioSessionHistoryResponse> {
  const requestedDirectory = input.directory ? absolute(input.directory) : undefined
  if (input.scope === "directory" && !requestedDirectory) throw new SessionHistoryInputError("directory is required for directory scope")
  if (
    requestedDirectory &&
    requestedDirectory !== absolute(input.roots.home) &&
    ![input.roots.cad, input.roots.pcb].some(
      (root) => root && (requestedDirectory === absolute(root) || isInside(root, requestedDirectory)),
    )
  ) {
    throw new SessionHistoryInputError("directory is outside Studio roots")
  }

  const search = input.search?.trim().toLocaleLowerCase()
  const output: StudioSessionHistoryItem[] = []
  const existence = new Map<string, Promise<boolean>>()
  const exists = (context: Omit<StudioSessionContext, "status">) => {
    const marker = contextMarker(context)
    const key = `${marker.kind}\0${marker.path}`
    const cached = existence.get(key)
    if (cached) return cached
    const pending = pathMatches(marker.path, marker.kind)
    existence.set(key, pending)
    return pending
  }

  // Bound OpenCode fetch — panel polls history; unbounded pulls grow with total sessions.
  // Prefer newest-first before classify so a non-ordered page still surfaces recent work.
  const limit = input.limit ?? DEFAULT_SESSION_HISTORY_LIMIT
  const sessions = [...(await input.source({ limit }))].sort(
    (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0) || b.id.localeCompare(a.id),
  )
  for (let offset = 0; offset < sessions.length; offset += 200) {
    const classified = await Promise.all(
      sessions.slice(offset, offset + 200).map((session) => classifySession(session, input.roots, exists)),
    )
    for (const item of classified) {
      if (!item) continue
      if (input.scope === "directory" && item.context.directory !== requestedDirectory) continue
      if (input.contextKey && item.context.key !== input.contextKey) continue
      if (search && !`${item.title}\n${item.context.label}\n${item.context.relativePath ?? ""}`.toLocaleLowerCase().includes(search))
        continue
      output.push(item)
    }
  }

  output.sort((a, b) => b.time.updated - a.time.updated || b.id.localeCompare(a.id))
  return { sessions: output }
}
