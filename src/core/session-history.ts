import type { StudioId } from "./registry"

export const STUDIO_SESSION_METADATA_KEY = "opencode-studio"

export type StudioSessionContextKind = "home" | `${StudioId}-root` | `${StudioId}-project`
export type StudioSessionContextStatus = "available" | "missing" | "moved"

export type StudioSessionMetadata = {
  schema: 1
  key: string
  kind: StudioSessionContextKind
  studioId?: StudioId
  projectId?: string
  relativePath?: string
  label: string
}

export type StudioSessionContext = StudioSessionMetadata & {
  directory: string
  historicalDirectory: string
  status: StudioSessionContextStatus
}

export type StudioSessionHistoryItem = {
  id: string
  title: string
  directory: string
  parentID?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  time: {
    created: number
    updated: number
  }
  context: StudioSessionContext
}

export type StudioSessionHistoryResponse = {
  sessions: StudioSessionHistoryItem[]
}

export function studioSessionMetadata(
  context: Pick<StudioSessionContext, "key" | "kind" | "label" | "studioId" | "projectId" | "relativePath">,
) {
  return {
    [STUDIO_SESSION_METADATA_KEY]: {
      schema: 1,
      key: context.key,
      kind: context.kind,
      studioId: context.studioId,
      projectId: context.projectId,
      relativePath: context.relativePath,
      label: context.label,
    } satisfies StudioSessionMetadata,
  }
}
