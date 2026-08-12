import { type AssemblyPlacementBlocker, type AssemblyResult, generatePickAndPlace } from "./assembly"
import { type BomIdentityBlocker, type BomResult, bomIdentityBlocker, generateBom } from "./bom"
import type { CatalogPart } from "./catalog"
import { type CircuitInspection, type ManufacturingBlocker, type ManufacturingBlockerOptions, manufacturingBlockers } from "./circuit-json"
import { loadNoConnectIntents, type NoConnectIntents } from "./tsx-intent"

export type CircuitReadiness = {
  fabricationReady: boolean
  assemblyReady: boolean
  manufacturingBlockers: ManufacturingBlocker[]
  assemblyBlockers: Array<ManufacturingBlocker | BomIdentityBlocker | AssemblyPlacementBlocker>
  bom: BomResult
  bomBlocker: BomIdentityBlocker | null
  placement: AssemblyResult
}

export type CircuitReadinessOptions = {
  inspection?: CircuitInspection
  bom?: BomResult
  catalogParts?: CatalogPart[]
  placement?: AssemblyResult
  /** Component name → intentionally unconnected pin names (noConnect in source). */
  noConnect?: NoConnectIntents
}

/** Shared fabrication/assembly gate used by tools, API, and workspace listing. */
export function circuitReadiness(json: unknown, options?: CircuitReadinessOptions): CircuitReadiness {
  const blockerOptions: ManufacturingBlockerOptions | undefined = options?.noConnect ? { noConnect: options.noConnect } : undefined
  const blockers = manufacturingBlockers(json, options?.inspection, blockerOptions)
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

/**
 * Readiness gate for a project on disk: resolves the `noConnect` intent
 * bridge from the project's own `src/circuit.tsx` before gating.
 */
export async function projectCircuitReadiness(
  projectDir: string,
  json: unknown,
  options: Omit<CircuitReadinessOptions, "noConnect"> = {},
): Promise<CircuitReadiness> {
  return circuitReadiness(json, { ...options, noConnect: await loadNoConnectIntents(projectDir) })
}
