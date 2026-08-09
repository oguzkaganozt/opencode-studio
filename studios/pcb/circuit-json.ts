import { lstat } from "node:fs/promises"
import { readRegularFileAt } from "../../src/core/paths"

export type CircuitElement = Record<string, unknown> & { type?: unknown }

/** Soft cap to avoid OOM when discovering many/huge circuit.json files. */
export const MAX_CIRCUIT_JSON_BYTES = 20 * 1024 * 1024

export type DiagnosticGroup = {
  type: string
  count: number
  messages: string[]
  omittedCount: number
  targets: DiagnosticTarget[]
}

export type DiagnosticTarget = {
  kind: "component" | "port" | "trace"
  refdes?: string
  portName?: string
  center?: [number, number]
  width?: number
  height?: number
  rotation?: number
  layer?: string
  layers?: string[]
  sourceComponentId?: string
  pcbComponentId?: string
  sourcePortId?: string
  pcbPortId?: string
  sourceTraceId?: string
  pcbTraceId?: string
}

export type CircuitInspection = {
  designValid: boolean
  errorCount: number
  warningCount: number
  errors: DiagnosticGroup[]
  warnings: DiagnosticGroup[]
}

export type ElementTypeCount = {
  type: string
  count: number
}

export type ManufacturingBlocker = {
  type: "invalid_design" | "placeholder_component" | "supplier_footprint_mismatch" | "unconnected_pin" | "unverified_part"
  count: number
  messages: string[]
}

export const PCB_PLACEHOLDER_PREFIX = "PCB_STUDIO_PLACEHOLDER:"

export function parseCircuitJson(value: unknown): CircuitElement[] {
  if (!Array.isArray(value)) throw new Error("Circuit JSON must be an array of elements")
  const invalidIndex = value.findIndex((element) => element === null || typeof element !== "object" || Array.isArray(element))
  if (invalidIndex >= 0) throw new Error(`Circuit JSON element at index ${invalidIndex} must be an object`)
  return value as CircuitElement[]
}

/**
 * Read circuit JSON confined to root (rejects symlinks and path escape).
 * Prefer workspace root for API/tools; project dir is acceptable for in-project build finals.
 */
export async function readCircuitJson(root: string, filePath: string): Promise<CircuitElement[]> {
  // Pre-check file size to avoid loading huge files into memory.
  const info = await lstat(filePath)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Circuit JSON file is not a regular file")
  if (info.size > MAX_CIRCUIT_JSON_BYTES) {
    throw new Error(`Circuit JSON exceeds ${MAX_CIRCUIT_JSON_BYTES} bytes`)
  }
  const buffer = await readRegularFileAt(root, filePath)
  return parseCircuitJson(JSON.parse(buffer.toString("utf8")))
}

const WARNING_SAMPLE_LIMIT = 3

function stringField(element: CircuitElement | undefined, field: string): string | undefined {
  const value = element?.[field]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stringArrayField(element: CircuitElement, field: string): string[] {
  const value = element[field]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function centerTuple(element: CircuitElement | undefined): [number, number] | undefined {
  const center = element?.center
  if (!center || typeof center !== "object" || Array.isArray(center)) return undefined
  const { x, y } = center as Record<string, unknown>
  return typeof x === "number" && typeof y === "number" ? [x, y] : undefined
}

function diagnosticTargets(byId: Map<string, CircuitElement>, diagnostic: CircuitElement): DiagnosticTarget[] {
  const targets: DiagnosticTarget[] = []
  const componentIds = new Set([
    ...stringArrayField(diagnostic, "pcb_component_ids"),
    ...([stringField(diagnostic, "pcb_component_id")].filter(Boolean) as string[]),
  ])
  for (const pcbComponentId of componentIds) {
    const component = byId.get(pcbComponentId)
    const sourceComponentId = stringField(component, "source_component_id")
    const sourceComponent = sourceComponentId ? byId.get(sourceComponentId) : undefined
    targets.push({
      kind: "component",
      refdes: stringField(sourceComponent, "name"),
      center: centerTuple(component),
      width: typeof component?.width === "number" ? component.width : undefined,
      height: typeof component?.height === "number" ? component.height : undefined,
      rotation: typeof component?.rotation === "number" ? component.rotation : undefined,
      layer: stringField(component, "layer"),
      sourceComponentId,
      pcbComponentId,
    })
  }

  for (const pcbPortId of stringArrayField(diagnostic, "pcb_port_ids")) {
    const port = byId.get(pcbPortId)
    const sourcePortId = stringField(port, "source_port_id")
    const sourcePort = sourcePortId ? byId.get(sourcePortId) : undefined
    const sourceComponentId = stringField(sourcePort, "source_component_id")
    const sourceComponent = sourceComponentId ? byId.get(sourceComponentId) : undefined
    targets.push({
      kind: "port",
      refdes: stringField(sourceComponent, "name"),
      portName: stringField(sourcePort, "name"),
      center: typeof port?.x === "number" && typeof port.y === "number" ? [port.x, port.y] : centerTuple(port),
      layers: Array.isArray(port?.layers) ? port.layers.filter((layer): layer is string => typeof layer === "string") : undefined,
      sourceComponentId,
      pcbComponentId: stringField(port, "pcb_component_id"),
      sourcePortId,
      pcbPortId,
    })
  }

  const sourceTraceId = stringField(diagnostic, "source_trace_id")
  const pcbTraceId = stringField(diagnostic, "pcb_trace_id")
  if (sourceTraceId || pcbTraceId) {
    targets.push({ kind: "trace", center: centerTuple(diagnostic), sourceTraceId, pcbTraceId })
  }

  return targets
}

function elementByIdMap(elements: CircuitElement[]) {
  const byId = new Map<string, CircuitElement>()
  for (const element of elements) {
    if (typeof element.type !== "string") continue
    const id = element[`${element.type}_id`]
    if (typeof id === "string") byId.set(id, element)
  }
  return byId
}

function diagnosticGroups(elements: CircuitElement[], suffix: "_error" | "_warning", byId: Map<string, CircuitElement>): DiagnosticGroup[] {
  const groups = new Map<string, { count: number; messages: string[]; targets: DiagnosticTarget[] }>()

  for (const element of elements) {
    if (typeof element.type !== "string" || !element.type.endsWith(suffix)) continue
    const group = groups.get(element.type) ?? { count: 0, messages: [], targets: [] }
    group.count += 1
    if (typeof element.message === "string" && element.message.length > 0) group.messages.push(element.message)
    group.targets.push(...diagnosticTargets(byId, element))
    groups.set(element.type, group)
  }

  return [...groups.entries()]
    .map(([type, group]) => {
      const messages = suffix === "_warning" ? group.messages.slice(0, WARNING_SAMPLE_LIMIT) : group.messages
      return { type, count: group.count, messages, omittedCount: group.messages.length - messages.length, targets: group.targets }
    })
    .sort((a, b) => a.type.localeCompare(b.type))
}

export function inspectCircuitJson(value: unknown): CircuitInspection {
  const elements = parseCircuitJson(value)
  const byId = elementByIdMap(elements)
  const errors = diagnosticGroups(elements, "_error", byId)
  const warnings = diagnosticGroups(elements, "_warning", byId)
  const errorCount = errors.reduce((total, group) => total + group.count, 0)
  const warningCount = warnings.reduce((total, group) => total + group.count, 0)

  return {
    designValid: errorCount === 0,
    errorCount,
    warningCount,
    errors,
    warnings,
  }
}

export function manufacturingBlockers(value: unknown, inspection?: CircuitInspection): ManufacturingBlocker[] {
  const elements = parseCircuitJson(value)
  const resolved = inspection ?? inspectCircuitJson(elements)
  const blockers: ManufacturingBlocker[] = []

  if (!resolved.designValid) {
    blockers.push({
      type: "invalid_design",
      count: resolved.errorCount,
      messages: resolved.errors.flatMap((group) => group.messages).slice(0, WARNING_SAMPLE_LIMIT),
    })
  }

  const placeholders = elements
    .filter((element) => element.type === "pcb_note_text" || element.type === "fabrication_note_text")
    .map((element) => (typeof element.text === "string" ? element.text : ""))
    .filter((text) => text.startsWith(PCB_PLACEHOLDER_PREFIX))
  if (placeholders.length > 0) {
    blockers.push({ type: "placeholder_component", count: placeholders.length, messages: placeholders })
  }

  const footprintMismatches = resolved.warnings.find((group) => group.type === "supplier_footprint_mismatch_warning")
  if (footprintMismatches) {
    blockers.push({
      type: "supplier_footprint_mismatch",
      count: footprintMismatches.count,
      messages: footprintMismatches.messages,
    })
  }

  const unverifiedIdentities = elements
    .filter((element) => element.type === "source_component" && (element.ftype === "simple_chip" || element.ftype === "complex"))
    .filter((element) => {
      const suppliers = element.supplier_part_numbers
      const hasSupplierIdentity =
        !!suppliers &&
        typeof suppliers === "object" &&
        !Array.isArray(suppliers) &&
        Object.entries(suppliers).some(
          ([supplier, partNumbers]) =>
            supplier.trim().length > 0 &&
            Array.isArray(partNumbers) &&
            partNumbers.some((partNumber) => typeof partNumber === "string" && partNumber.trim().length > 0),
        )
      return !hasSupplierIdentity
    })
    .map((element) => {
      const name = typeof element.name === "string" && element.name.trim() ? element.name.trim() : "Unnamed chip"
      const mpn = typeof element.manufacturer_part_number === "string" ? element.manufacturer_part_number.trim() : ""
      return mpn
        ? `${name} (${mpn}) has no verifiable supplier part number`
        : `${name} has no manufacturer part number or verifiable supplier part number`
    })
  if (unverifiedIdentities.length > 0) {
    blockers.push({
      type: "unverified_part",
      count: unverifiedIdentities.length,
      messages: unverifiedIdentities.slice(0, WARNING_SAMPLE_LIMIT),
    })
  }

  const unconnectedPins = resolved.warnings.find((group) => group.type === "source_pin_missing_trace_warning")
  if (unconnectedPins) {
    blockers.push({ type: "unconnected_pin", count: unconnectedPins.count, messages: unconnectedPins.messages })
  }

  return blockers
}

export function elementTypeCounts(value: unknown): ElementTypeCount[] {
  const counts = new Map<string, number>()
  for (const element of parseCircuitJson(value)) {
    const type = typeof element.type === "string" ? element.type : "unknown"
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => a.type.localeCompare(b.type))
}

export function circuitSummary(value: unknown) {
  const elements = parseCircuitJson(value)
  const counts = new Map(elementTypeCounts(elements).map(({ type, count }) => [type, count]))
  return {
    totalElements: elements.length,
    components: counts.get("source_component") ?? 0,
    nets: counts.get("source_net") ?? 0,
    traces: counts.get("source_trace") ?? 0,
  }
}

export function selectCircuitElements(
  value: unknown,
  options: { types: string[]; offset: number; limit: number },
): { elements: CircuitElement[]; total: number; returned: number; hasMore: boolean } {
  const requestedTypes = new Set(options.types)
  const filtered = parseCircuitJson(value).filter((element) => typeof element.type === "string" && requestedTypes.has(element.type))
  const elements = filtered.slice(options.offset, options.offset + options.limit)
  return {
    elements,
    total: filtered.length,
    returned: elements.length,
    hasMore: options.offset + elements.length < filtered.length,
  }
}

export function queryCircuitJson(
  value: unknown,
  options: { types?: string[]; offset?: number; limit?: number; includeFullJson?: boolean } = {},
): Record<string, unknown> {
  const elements = parseCircuitJson(value)
  const result: Record<string, unknown> = {
    summary: circuitSummary(elements),
    diagnostics: inspectCircuitJson(elements),
    elementTypes: elementTypeCounts(elements),
  }
  if (options.types) {
    result.selection = selectCircuitElements(elements, {
      types: options.types,
      offset: options.offset ?? 0,
      limit: options.limit ?? 100,
    })
  }
  if (options.includeFullJson) result.circuitJson = elements
  return result
}
