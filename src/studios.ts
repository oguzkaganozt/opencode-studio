import { cadStudio } from "../studios/cad/studio"
import { mediaStudio } from "../studios/media/studio"
import { pcbStudio } from "../studios/pcb/studio"
import { STUDIO_IDS, type StudioDefinition, type StudioId } from "./core/registry"

const CATALOG: Record<StudioId, StudioDefinition> = {
  cad: cadStudio,
  pcb: pcbStudio,
  media: mediaStudio,
}

export function getStudioDefinition(id: StudioId): StudioDefinition {
  return CATALOG[id]
}

export function listStudioDefinitions(): StudioDefinition[] {
  return STUDIO_IDS.map((id) => CATALOG[id])
}
