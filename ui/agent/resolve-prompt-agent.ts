import type { StudioId } from "../../src/core/registry"

export type PromptAgent = "build" | `studio-${StudioId}`

export function resolvePromptAgent(studioId?: StudioId): PromptAgent {
  return studioId ? `studio-${studioId}` : "build"
}
