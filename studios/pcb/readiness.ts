import { type AssemblyPlacementBlocker, type AssemblyResult, generatePickAndPlace } from "./assembly"
import { type BomIdentityBlocker, type BomResult, bomIdentityBlocker, generateBom } from "./bom"
import type { CatalogPart } from "./catalog"
import {
  type CircuitInspection,
  inspectEffectiveCircuitJson,
  type ManufacturingBlocker,
  type ManufacturingBlockerOptions,
  manufacturingBlockers,
} from "./circuit-json"
import { type ComponentEvidenceRecord, matchComplexComponentInstances, readComponentEvidence } from "./component-evidence"
import { loadNoConnectIntents, type NoConnectIntents } from "./tsx-intent"

export type CircuitReadiness = {
  inspection: CircuitInspection
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
  const inspection = inspectEffectiveCircuitJson(json, options?.noConnect)
  const blockers = manufacturingBlockers(json, inspection, blockerOptions)
  const bom = options?.bom ?? generateBom(json, options?.catalogParts)
  const bomBlocker = bomIdentityBlocker(bom)
  const placement = options?.placement ?? generatePickAndPlace(json)
  const fabricationReady = blockers.length === 0
  const assemblyBlockers = [...blockers, ...(bomBlocker ? [bomBlocker] : []), ...placement.blockers]
  return {
    inspection,
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
  const readiness = circuitReadiness(json, { ...options, noConnect: await loadNoConnectIntents(projectDir) })
  let evidenceRecords: ComponentEvidenceRecord[] = []
  try {
    evidenceRecords = (await readComponentEvidence(projectDir)).records
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = `Component implementation evidence is unreadable: ${error instanceof Error ? error.message : String(error)}`
      const blocker: ManufacturingBlocker = { type: "unverified_part", count: 1, messages: [message], issues: [{ message }] }
      return {
        ...readiness,
        fabricationReady: false,
        assemblyReady: false,
        manufacturingBlockers: [...readiness.manufacturingBlockers, blocker],
        assemblyBlockers: [...readiness.assemblyBlockers, blocker],
      }
    }
  }

  let issues: ManufacturingBlocker["issues"] = []
  try {
    issues = matchComplexComponentInstances(json, evidenceRecords)
      .filter((match) => !match.matched)
      .map((match) => ({
        refdes: match.refdes,
        message: `${match.refdes} has no smoke-tested implementation matching its ${match.mismatches.join(", ")}`,
      }))
  } catch (error) {
    const message = `Component implementation could not be fingerprinted: ${error instanceof Error ? error.message : String(error)}`
    issues = [{ message }]
  }
  if (issues.length === 0) return readiness

  const blocker: ManufacturingBlocker = {
    type: "unverified_part",
    count: issues.length,
    messages: issues.slice(0, 20).map((issue) => issue.message),
    issues: issues.slice(0, 20),
  }
  return {
    ...readiness,
    fabricationReady: false,
    assemblyReady: false,
    manufacturingBlockers: [...readiness.manufacturingBlockers, blocker],
    assemblyBlockers: [...readiness.assemblyBlockers, blocker],
  }
}
