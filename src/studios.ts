import { cadStudio } from "../studios/cad/studio"
import { pcbStudio } from "../studios/pcb/studio"
import { assertCatalogComplete, STUDIO_IDS, type StudioDefinition, type StudioId } from "./core/registry"

export { assertCatalogComplete }

const CATALOG: Record<StudioId, StudioDefinition> = {
  cad: cadStudio,
  pcb: pcbStudio,
}

export function getStudioDefinition(id: StudioId): StudioDefinition {
  return CATALOG[id]
}

export function listStudioDefinitions(): StudioDefinition[] {
  return STUDIO_IDS.map((id) => CATALOG[id])
}
