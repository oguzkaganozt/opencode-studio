import type { CircuitElement } from "./circuit-json"
import { csvCell } from "./csv"

export type AssemblyEntry = {
  designator: string
  midX: number
  midY: number
  layer: "Top" | "Bottom"
  rotation: number
  mpn: string | null
}

export type AssemblyResult = {
  entries: AssemblyEntry[]
  totalComponents: number
  skipped: number
  expectedComponents: number
  intentionallySkipped: number
  assemblyReady: boolean
  blockers: AssemblyPlacementBlocker[]
}

export type AssemblyPlacementBlocker = {
  type: "missing_placement" | "malformed_placement" | "unknown_source_mapping"
  count: number
  messages: string[]
}

export function generatePickAndPlace(circuitJson: unknown): AssemblyResult {
  const elements = Array.isArray(circuitJson) ? (circuitJson as CircuitElement[]) : []

  const sourceNames = new Map<string, string>()
  const sourceMpns = new Map<string, string | null>()
  const sourceIds = new Set<string>()
  const expectedSourceIds = new Set<string>()
  let intentionallySkipped = 0
  for (const element of elements) {
    if (element.type !== "source_component") continue
    const id = element.source_component_id
    if (typeof id !== "string" || !id) continue
    sourceIds.add(id)
    if (typeof element.name === "string" && element.name.length > 0) {
      sourceNames.set(id, element.name)
    }
    const mpn = element.manufacturer_part_number
    sourceMpns.set(id, typeof mpn === "string" && mpn.trim().length > 0 ? mpn.trim() : null)
    if (element.do_not_place === true) intentionallySkipped++
    else expectedSourceIds.add(id)
  }

  const entries: AssemblyEntry[] = []
  let skipped = 0
  const coveredSourceIds = new Set<string>()
  const malformed: string[] = []
  const unknownMappings: string[] = []

  for (const element of elements) {
    if (element.type !== "pcb_component") continue
    const sourceId = element.source_component_id
    if (typeof sourceId !== "string" || !sourceIds.has(sourceId)) {
      unknownMappings.push(`PCB component ${String(element.pcb_component_id ?? "?")} does not map to a known source component`)
      skipped++
      continue
    }
    if (!expectedSourceIds.has(sourceId)) continue
    coveredSourceIds.add(sourceId)
    if (element.do_not_place === true) {
      intentionallySkipped++
      skipped++
      continue
    }

    const designator = sourceNames.get(sourceId) ?? "?"
    const center = element.center as { x?: number; y?: number } | undefined
    if (
      !center ||
      typeof center.x !== "number" ||
      !Number.isFinite(center.x) ||
      typeof center.y !== "number" ||
      !Number.isFinite(center.y) ||
      (element.layer !== "top" && element.layer !== "bottom") ||
      (element.rotation !== undefined && (typeof element.rotation !== "number" || !Number.isFinite(element.rotation)))
    ) {
      malformed.push(`${designator} has an invalid center, layer, or rotation`)
      skipped++
      continue
    }

    const layer = element.layer === "bottom" ? "Bottom" : "Top"
    const rotation = typeof element.rotation === "number" ? element.rotation : 0

    entries.push({
      designator,
      midX: center.x,
      midY: center.y,
      layer,
      rotation,
      mpn: sourceMpns.get(sourceId) ?? null,
    })
  }

  entries.sort((a, b) => a.designator.localeCompare(b.designator))

  const missing = [...expectedSourceIds]
    .filter((sourceId) => !coveredSourceIds.has(sourceId))
    .map((sourceId) => `${sourceNames.get(sourceId) ?? sourceId} has no PCB placement`)
  const blockers: AssemblyPlacementBlocker[] = []
  if (missing.length > 0) blockers.push({ type: "missing_placement", count: missing.length, messages: missing })
  if (malformed.length > 0) blockers.push({ type: "malformed_placement", count: malformed.length, messages: malformed })
  if (unknownMappings.length > 0) {
    blockers.push({ type: "unknown_source_mapping", count: unknownMappings.length, messages: unknownMappings })
  }

  return {
    entries,
    totalComponents: entries.length,
    skipped,
    expectedComponents: expectedSourceIds.size,
    intentionallySkipped,
    assemblyReady: blockers.length === 0,
    blockers,
  }
}

export function toCplCsv(entries: AssemblyEntry[]): string {
  const header = "Designator,Mid X,Mid Y,Rotation,Layer,MPN"
  const rows = entries.map((e) => `${csvCell(e.designator)},${e.midX},${e.midY},${e.rotation},${csvCell(e.layer)},${csvCell(e.mpn)}`)
  return `${[header, ...rows].join("\n")}\n`
}
