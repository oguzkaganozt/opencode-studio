import { type BomIdentityBlocker, type BomResult, bomIdentityBlocker, generateBom } from "./bom"
import type { CatalogPart } from "./catalog"
import { type CircuitInspection, type ManufacturingBlocker, manufacturingBlockers } from "./circuit-json"

export type CircuitReadiness = {
  fabricationReady: boolean
  assemblyReady: boolean
  manufacturingBlockers: ManufacturingBlocker[]
  assemblyBlockers: Array<ManufacturingBlocker | BomIdentityBlocker>
  bom: BomResult
  bomBlocker: BomIdentityBlocker | null
}

/** Shared fabrication/assembly gate used by tools, API, and workspace listing. */
export function circuitReadiness(
  json: unknown,
  options?: {
    inspection?: CircuitInspection
    bom?: BomResult
    catalogParts?: CatalogPart[]
  },
): CircuitReadiness {
  const blockers = manufacturingBlockers(json, options?.inspection)
  const bom = options?.bom ?? generateBom(json, options?.catalogParts)
  const bomBlocker = bomIdentityBlocker(bom)
  const fabricationReady = blockers.length === 0
  return {
    fabricationReady,
    assemblyReady: fabricationReady && bom.bomComplete,
    manufacturingBlockers: blockers,
    assemblyBlockers: [...blockers, ...(bomBlocker ? [bomBlocker] : [])],
    bom,
    bomBlocker,
  }
}
