import { agentNameFor } from "../../src/core/package-meta"
import type { StudioId } from "../../src/core/registry"

export type PromptAgent = "build" | ReturnType<typeof agentNameFor>

export function resolvePromptAgent(studioId?: StudioId): PromptAgent {
  return studioId ? agentNameFor(studioId) : "build"
}
