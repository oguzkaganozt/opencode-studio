import { cadStudio } from "../studios/cad/studio"
import { fwStudio } from "../studios/fw/studio"
import { pcbStudio } from "../studios/pcb/studio"
import { STUDIO_IDS, type StudioDefinition, type StudioId } from "./core/registry"

const CATALOG: Record<StudioId, StudioDefinition> = {
  cad: cadStudio,
  pcb: pcbStudio,
  fw: fwStudio,
}

export function getStudioDefinition(id: StudioId): StudioDefinition {
  return CATALOG[id]
}

export function listStudioDefinitions(): StudioDefinition[] {
  return STUDIO_IDS.map((id) => CATALOG[id])
}
