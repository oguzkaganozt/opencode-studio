import type { CircuitElement } from "./circuit-json"

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
}

export function generatePickAndPlace(circuitJson: unknown): AssemblyResult {
  const elements = Array.isArray(circuitJson) ? (circuitJson as CircuitElement[]) : []

  const sourceNames = new Map<string, string>()
  const sourceMpns = new Map<string, string | null>()
  for (const element of elements) {
    if (element.type !== "source_component") continue
    const id = element.source_component_id
    if (typeof id !== "string" || !id) continue
    if (typeof element.name === "string" && element.name.length > 0) {
      sourceNames.set(id, element.name)
    }
    const mpn = element.manufacturer_part_number
    sourceMpns.set(id, typeof mpn === "string" && mpn.length > 0 ? mpn : null)
  }

  const entries: AssemblyEntry[] = []
  let skipped = 0

  for (const element of elements) {
    if (element.type !== "pcb_component") continue
    if (element.do_not_place === true) {
      skipped++
      continue
    }

    const sourceId = element.source_component_id
    if (typeof sourceId !== "string") {
      skipped++
      continue
    }

    const designator = sourceNames.get(sourceId) ?? "?"
    const center = element.center as { x?: number; y?: number } | undefined
    if (!center || typeof center.x !== "number" || typeof center.y !== "number") {
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

  return { entries, totalComponents: entries.length, skipped }
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

export function toCplCsv(entries: AssemblyEntry[]): string {
  const header = "Designator,Mid X,Mid Y,Rotation,Layer,MPN"
  const rows = entries.map((e) => `${csvCell(e.designator)},${e.midX},${e.midY},${e.rotation},${csvCell(e.layer)},${csvCell(e.mpn)}`)
  return `${[header, ...rows].join("\n")}\n`
}
