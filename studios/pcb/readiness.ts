import { type AssemblyPlacementBlocker, type AssemblyResult, generatePickAndPlace } from "./assembly"
import { type BomIdentityBlocker, type BomResult, bomIdentityBlocker, generateBom } from "./bom"
import type { CatalogPart } from "./catalog"
import { type CircuitInspection, type ManufacturingBlocker, manufacturingBlockers } from "./circuit-json"

export type CircuitReadiness = {
  fabricationReady: boolean
  assemblyReady: boolean
  manufacturingBlockers: ManufacturingBlocker[]
  assemblyBlockers: Array<ManufacturingBlocker | BomIdentityBlocker | AssemblyPlacementBlocker>
  bom: BomResult
  bomBlocker: BomIdentityBlocker | null
  placement: AssemblyResult
}

/** Shared fabrication/assembly gate used by tools, API, and workspace listing. */
export function circuitReadiness(
  json: unknown,
  options?: {
    inspection?: CircuitInspection
    bom?: BomResult
    catalogParts?: CatalogPart[]
    placement?: AssemblyResult
  },
): CircuitReadiness {
  const blockers = manufacturingBlockers(json, options?.inspection)
  const bom = options?.bom ?? generateBom(json, options?.catalogParts)
  const bomBlocker = bomIdentityBlocker(bom)
  const placement = options?.placement ?? generatePickAndPlace(json)
  const fabricationReady = blockers.length === 0
  const assemblyBlockers = [...blockers, ...(bomBlocker ? [bomBlocker] : []), ...placement.blockers]
  return {
    fabricationReady,
    assemblyReady: assemblyBlockers.length === 0,
    manufacturingBlockers: blockers,
    assemblyBlockers,
    bom,
    bomBlocker,
    placement,
  }
}
