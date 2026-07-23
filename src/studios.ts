import { cadStudio } from "../studios/cad/studio"
import { mediaStudio } from "../studios/media/studio"
import { pcbStudio } from "../studios/pcb/studio"
import { startupStudio } from "../studios/startup/studio"
import type { StudioDefinition, StudioId } from "./core/registry"
import { STUDIO_IDS } from "./core/registry"

const CATALOG: Record<StudioId, StudioDefinition> = {
  cad: cadStudio,
  media: mediaStudio,
  pcb: pcbStudio,
  startup: startupStudio,
}

export function getStudioDefinition(id: StudioId): StudioDefinition {
  return CATALOG[id]
}

export function listStudioDefinitions(): StudioDefinition[] {
  return STUDIO_IDS.map((id) => CATALOG[id])
}

export function assertCatalogComplete(loaderIds: string[], label: string) {
  const expected = [...STUDIO_IDS].sort()
  const actual = [...new Set(loaderIds)].sort()
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error(`${label} loader IDs must match catalog exactly. expected=${expected.join(",")} actual=${actual.join(",")}`)
  }
}
