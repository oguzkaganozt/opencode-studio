import type { CatalogPart } from "./catalog"
import type { CircuitElement } from "./circuit-json"
import { csvCell } from "./csv"

export type BomEntry = {
  mpn: string | null
  supplierPartNumbers: Record<string, string[]>
  refdes: string[]
  quantity: number
  manufacturer: string | null
  description: string | null
  datasheet: string | null
  category: string | null
}

export type BomResult = {
  entries: BomEntry[]
  totalComponents: number
  componentsWithMpn: number
  componentsWithoutMpn: number
  componentsWithSupplierPartNumbers: number
  componentsWithoutPartNumbers: number
  bomComplete: boolean
  listedCount: number
  unlistedCount: number
}

export type BomIdentityBlocker = {
  type: "bom_incomplete"
  count: number
  messages: string[]
}

export function bomIdentityBlocker(bom: BomResult): BomIdentityBlocker | null {
  if (bom.bomComplete) return null
  const refdes = bom.entries
    .filter((entry) => entry.mpn === null && Object.keys(entry.supplierPartNumbers).length === 0)
    .flatMap((entry) => entry.refdes)
  return {
    type: "bom_incomplete",
    count: bom.componentsWithoutPartNumbers,
    messages: [`Missing manufacturer or supplier part numbers: ${refdes.join(", ")}`],
  }
}

function mpnField(component: CircuitElement): string | null {
  const value = component.manufacturer_part_number
  if (typeof value === "string" && value.length > 0) return value
  return null
}

function supplierPartNumbersField(component: CircuitElement): Record<string, string[]> {
  const value = component.supplier_part_numbers
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const entries: Array<[string, string[]]> = Object.entries(value as Record<string, unknown>)
    .map(
      ([supplier, partNumbers]) =>
        [
          supplier,
          Array.isArray(partNumbers)
            ? [...new Set(partNumbers.filter((partNumber): partNumber is string => typeof partNumber === "string"))].sort()
            : [],
        ] as [string, string[]],
    )
    .filter(([, partNumbers]) => partNumbers.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries)
}

function supplierPartNumbersKey(value: Record<string, string[]>): string | null {
  return Object.keys(value).length > 0 ? JSON.stringify(value) : null
}

function mergeSupplierPartNumbers(target: Record<string, string[]>, source: Record<string, string[]>): void {
  for (const [supplier, partNumbers] of Object.entries(source)) {
    target[supplier] = [...new Set([...(target[supplier] ?? []), ...partNumbers])].sort()
  }
}

function refdes(component: CircuitElement): string | null {
  const value = component.name
  if (typeof value === "string" && value.length > 0) return value
  return null
}

const catalogIndex = (parts: CatalogPart[]): Map<string, CatalogPart> => {
  const index = new Map<string, CatalogPart>()
  for (const part of parts) {
    const key = part.mpn.toLowerCase()
    if (!index.has(key)) index.set(key, part)
  }
  return index
}

export function generateBom(circuitJson: unknown, catalogParts: CatalogPart[] = []): BomResult {
  const elements = Array.isArray(circuitJson) ? (circuitJson as CircuitElement[]) : []
  const catalog = catalogIndex(catalogParts)

  const mpnGroups = new Map<string, { refdes: string[]; mpn: string; supplierPartNumbers: Record<string, string[]> }>()
  const supplierGroups = new Map<string, { refdes: string[]; supplierPartNumbers: Record<string, string[]> }>()
  const unlisted: { refdes: string[] } = { refdes: [] }

  for (const element of elements) {
    if (element.type !== "source_component") continue

    const ref = refdes(element) ?? "?"
    const mpn = mpnField(element)
    const supplierPartNumbers = supplierPartNumbersField(element)

    if (mpn) {
      const group = mpnGroups.get(mpn) ?? { refdes: [], mpn, supplierPartNumbers: {} }
      group.refdes.push(ref)
      mergeSupplierPartNumbers(group.supplierPartNumbers, supplierPartNumbers)
      mpnGroups.set(mpn, group)
    } else if (supplierPartNumbersKey(supplierPartNumbers)) {
      const key = supplierPartNumbersKey(supplierPartNumbers) as string
      const group = supplierGroups.get(key) ?? { refdes: [], supplierPartNumbers }
      group.refdes.push(ref)
      supplierGroups.set(key, group)
    } else {
      unlisted.refdes.push(ref)
    }
  }

  const entries: BomEntry[] = []

  for (const [, group] of mpnGroups) {
    const part = catalog.get(group.mpn.toLowerCase())
    entries.push({
      mpn: group.mpn,
      supplierPartNumbers: group.supplierPartNumbers,
      refdes: group.refdes.sort(),
      quantity: group.refdes.length,
      manufacturer: part?.manufacturer ?? null,
      description: part?.description ?? null,
      datasheet: part?.datasheet ?? null,
      category: part?.category ?? null,
    })
  }

  for (const group of supplierGroups.values()) {
    entries.push({
      mpn: null,
      supplierPartNumbers: group.supplierPartNumbers,
      refdes: group.refdes.sort(),
      quantity: group.refdes.length,
      manufacturer: null,
      description: null,
      datasheet: null,
      category: null,
    })
  }

  entries.sort((a, b) => (a.mpn ?? JSON.stringify(a.supplierPartNumbers)).localeCompare(b.mpn ?? JSON.stringify(b.supplierPartNumbers)))

  if (unlisted.refdes.length > 0) {
    entries.push({
      mpn: null,
      supplierPartNumbers: {},
      refdes: unlisted.refdes.sort(),
      quantity: unlisted.refdes.length,
      manufacturer: null,
      description: null,
      datasheet: null,
      category: null,
    })
  }

  const componentsWithMpn = [...mpnGroups.values()].reduce((sum, group) => sum + group.refdes.length, 0)
  const componentsWithSupplierPartNumbers = [...mpnGroups.values(), ...supplierGroups.values()].reduce(
    (sum, group) => sum + (Object.keys(group.supplierPartNumbers).length > 0 ? group.refdes.length : 0),
    0,
  )
  const componentsWithoutMpn = [...supplierGroups.values()].reduce((sum, group) => sum + group.refdes.length, unlisted.refdes.length)
  const componentsWithoutPartNumbers = unlisted.refdes.length
  return {
    entries,
    totalComponents: entries.reduce((sum, e) => sum + e.quantity, 0),
    componentsWithMpn,
    componentsWithoutMpn,
    componentsWithSupplierPartNumbers,
    componentsWithoutPartNumbers,
    bomComplete: componentsWithoutPartNumbers === 0,
    listedCount: mpnGroups.size + supplierGroups.size,
    unlistedCount: componentsWithoutPartNumbers,
  }
}

export function toBomCsv(entries: BomEntry[]): string {
  const header = "MPN,Supplier Part Numbers,Refdes,Quantity,Manufacturer,Description,Datasheet,Category"
  const rows = entries.map((e) =>
    [
      csvCell(e.mpn),
      csvCell(
        Object.entries(e.supplierPartNumbers)
          .map(([supplier, partNumbers]) => `${supplier}:${partNumbers.join("|")}`)
          .join("; "),
      ),
      csvCell(e.refdes.join("; ")),
      String(e.quantity),
      csvCell(e.manufacturer),
      csvCell(e.description),
      csvCell(e.datasheet),
      csvCell(e.category),
    ].join(","),
  )
  return `${[header, ...rows].join("\n")}\n`
}
