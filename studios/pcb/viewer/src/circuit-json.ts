export const CIRCUIT_JSON_PAGE_SIZE = 100

export type CircuitJsonElement = Record<string, unknown>

export interface IndexedCircuitElement {
  element: CircuitJsonElement
  index: number
  type: string
}

function isCircuitJsonElement(value: unknown): value is CircuitJsonElement {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function filterCircuitElements(elements: unknown[], search: string): IndexedCircuitElement[] {
  const query = search.trim().toLowerCase()
  const matches: IndexedCircuitElement[] = []

  for (let index = 0; index < elements.length; index += 1) {
    const value = elements[index]
    if (!isCircuitJsonElement(value)) continue
    const type = String(value.type ?? "unknown")
    if (query) {
      let matched = false
      for (const field of Object.values(value)) {
        if ((typeof field === "string" || typeof field === "number" || typeof field === "boolean") && String(field).toLowerCase().includes(query)) {
          matched = true
          break
        }
      }
      if (!matched) continue
    }
    matches.push({ element: value, index, type })
  }

  return matches
}

export function circuitElementPage(elements: IndexedCircuitElement[], page: number, pageSize = CIRCUIT_JSON_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(elements.length / pageSize))
  const safePage = Math.min(Math.max(0, page), pageCount - 1)
  const start = safePage * pageSize
  return {
    page: safePage,
    pageCount,
    start,
    elements: elements.slice(start, start + pageSize),
  }
}
