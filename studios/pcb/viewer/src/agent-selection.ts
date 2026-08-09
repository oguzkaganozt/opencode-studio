import type { AgentHandoffRequest } from "@ui/agent-handoff"

type CircuitElement = Record<string, unknown>

export type PcbAgentSelection = {
  kind: "component" | "net" | "region"
  label: string
  summary: string
  details: string[]
}

export type PcbSelectionIndex = {
  schematicComponents: Map<string, CircuitElement>
  schematicPorts: Map<string, CircuitElement>
  sourceComponents: Map<string, CircuitElement>
  sourcePorts: Map<string, CircuitElement>
  sourceNets: CircuitElement[]
  sourceTraces: CircuitElement[]
  schematicTraces: CircuitElement[]
  pcbComponents: CircuitElement[]
  pcbTraces: CircuitElement[]
}

type PcbRegionBounds = { minX: number; minY: number; maxX: number; maxY: number }

function asElement(value: unknown): CircuitElement | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CircuitElement) : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter((item): item is string => Boolean(item))
}

function putById(map: Map<string, CircuitElement>, element: CircuitElement, key: string) {
  const id = text(element[key])
  if (id) map.set(id, element)
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function point(value: unknown): { x: number; y: number } | undefined {
  const record = asElement(value)
  const x = number(record?.x)
  const y = number(record?.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function fixed(value: number): string {
  return value.toFixed(3).replace(/\.?(?:0+)$/, "")
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function componentLabel(index: PcbSelectionIndex, sourceComponentID: string | undefined, fallback: string): string {
  const component = sourceComponentID ? index.sourceComponents.get(sourceComponentID) : undefined
  return text(component?.name) || sourceComponentID || fallback
}

function portLabel(index: PcbSelectionIndex, port: CircuitElement): string {
  const component = componentLabel(index, text(port.source_component_id), "component")
  const pin = text(port.name) || text(port.most_frequently_referenced_by_name) || text(port.pin_number) || text(port.source_port_id) || "port"
  return `${component}.${pin}`
}

export function createPcbSelectionIndex(input: unknown): PcbSelectionIndex {
  const index: PcbSelectionIndex = {
    schematicComponents: new Map(),
    schematicPorts: new Map(),
    sourceComponents: new Map(),
    sourcePorts: new Map(),
    sourceNets: [],
    sourceTraces: [],
    schematicTraces: [],
    pcbComponents: [],
    pcbTraces: [],
  }

  if (!Array.isArray(input)) return index
  for (const value of input) {
    const element = asElement(value)
    if (!element) continue
    switch (element.type) {
      case "schematic_component":
        putById(index.schematicComponents, element, "schematic_component_id")
        break
      case "schematic_port": {
        putById(index.schematicPorts, element, "schematic_port_id")
        putById(index.schematicPorts, element, "source_port_id")
        break
      }
      case "source_component":
        putById(index.sourceComponents, element, "source_component_id")
        break
      case "source_port":
        putById(index.sourcePorts, element, "source_port_id")
        break
      case "source_net":
        index.sourceNets.push(element)
        break
      case "source_trace":
        index.sourceTraces.push(element)
        break
      case "schematic_trace":
        index.schematicTraces.push(element)
        break
      case "pcb_component":
        index.pcbComponents.push(element)
        break
      case "pcb_trace":
        index.pcbTraces.push(element)
        break
    }
  }
  return index
}

export function pickSchematicComponent(index: PcbSelectionIndex, schematicComponentID: string): PcbAgentSelection | null {
  const schematic = index.schematicComponents.get(schematicComponentID)
  if (!schematic) return null
  const sourceComponentID = text(schematic.source_component_id)
  const source = sourceComponentID ? index.sourceComponents.get(sourceComponentID) : undefined
  const placements = sourceComponentID
    ? index.pcbComponents.filter((element) => text(element.source_component_id) === sourceComponentID)
    : []
  const label = text(source?.name) || text(schematic.symbol_display_value) || sourceComponentID || schematicComponentID
  const details = unique([
    sourceComponentID ? `source_component_id=${sourceComponentID}` : undefined,
    `schematic_component_id=${schematicComponentID}`,
    text(schematic.schematic_sheet_id) ? `schematic_sheet_id=${text(schematic.schematic_sheet_id)}` : undefined,
    text(source?.manufacturer_part_number) ? `mpn=${text(source?.manufacturer_part_number)}` : undefined,
    text(schematic.symbol_display_value) ? `value=${text(schematic.symbol_display_value)}` : undefined,
  ])

  const pcbIDs = unique(placements.map((element) => text(element.pcb_component_id)))
  if (pcbIDs.length) details.push(`pcb_component_ids=${pcbIDs.join(",")}`)
  for (const placement of placements) {
    const center = point(placement.center)
    const width = number(placement.width)
    const height = number(placement.height)
    const fields = [
      text(placement.pcb_component_id),
      center ? `center=(${fixed(center.x)},${fixed(center.y)})` : undefined,
      width !== undefined && height !== undefined ? `size=(${fixed(width)},${fixed(height)})` : undefined,
      text(placement.rotation) ? `rotation_deg=${text(placement.rotation)}` : undefined,
      text(placement.layer) ? `layer=${text(placement.layer)}` : undefined,
    ].filter(Boolean)
    details.push(`placement_mm=${fields.join(" ")}`)
  }

  return { kind: "component", label, summary: label, details }
}

export function pickNetFromSchematicPort(index: PcbSelectionIndex, callbackID: string): PcbAgentSelection | null {
  const schematicPort = index.schematicPorts.get(callbackID)
  const sourcePortID = text(schematicPort?.source_port_id) || (index.sourcePorts.has(callbackID) ? callbackID : undefined)
  const sourcePort = sourcePortID ? index.sourcePorts.get(sourcePortID) : undefined
  if (!sourcePortID || !sourcePort) return null

  const connectivityKey = text(sourcePort.subcircuit_connectivity_map_key)
  let traces = index.sourceTraces.filter(
    (trace) =>
      textList(trace.connected_source_port_ids).includes(sourcePortID) ||
      Boolean(connectivityKey && text(trace.subcircuit_connectivity_map_key) === connectivityKey),
  )
  const netIDs = new Set(traces.flatMap((trace) => textList(trace.connected_source_net_ids)))
  const nets = index.sourceNets.filter((net) => {
    const netID = text(net.source_net_id)
    const matches = Boolean((netID && netIDs.has(netID)) || (connectivityKey && text(net.subcircuit_connectivity_map_key) === connectivityKey))
    if (matches && netID) netIDs.add(netID)
    return matches
  })
  if (netIDs.size) {
    traces = index.sourceTraces.filter(
      (trace) =>
        textList(trace.connected_source_net_ids).some((id) => netIDs.has(id)) ||
        textList(trace.connected_source_port_ids).includes(sourcePortID) ||
        Boolean(connectivityKey && text(trace.subcircuit_connectivity_map_key) === connectivityKey),
    )
  }
  if (!traces.length && !nets.length) return null

  const sourceTraceIDs = unique(traces.map((trace) => text(trace.source_trace_id)))
  const endpointIDs = unique(traces.flatMap((trace) => textList(trace.connected_source_port_ids)))
  const endpoints = unique(endpointIDs.map((id) => index.sourcePorts.get(id)).filter(Boolean).map((port) => portLabel(index, port!)))
  const netNames = unique(nets.map((net) => text(net.name)))
  const traceNames = unique(traces.flatMap((trace) => [text(trace.display_name), text(trace.name)]))
  const label = netNames.join(" / ") || traceNames[0] || endpoints.join(" ↔ ") || portLabel(index, sourcePort)
  const schematicTraceIDs = unique(
    index.schematicTraces
      .filter((trace) => sourceTraceIDs.includes(text(trace.source_trace_id) || ""))
      .map((trace) => text(trace.schematic_trace_id)),
  )
  const pcbTraceIDs = unique(
    index.pcbTraces.filter((trace) => sourceTraceIDs.includes(text(trace.source_trace_id) || "")).map((trace) => text(trace.pcb_trace_id)),
  )
  const connectivityKeys = unique([
    connectivityKey,
    ...traces.map((trace) => text(trace.subcircuit_connectivity_map_key)),
    ...nets.map((net) => text(net.subcircuit_connectivity_map_key)),
  ])
  const details = [
    `picked_port=${portLabel(index, sourcePort)}`,
    `source_port_id=${sourcePortID}`,
    netIDs.size ? `source_net_ids=${[...netIDs].join(",")}` : undefined,
    sourceTraceIDs.length ? `source_trace_ids=${sourceTraceIDs.join(",")}` : undefined,
    schematicTraceIDs.length ? `schematic_trace_ids=${schematicTraceIDs.join(",")}` : undefined,
    pcbTraceIDs.length ? `pcb_trace_ids=${pcbTraceIDs.join(",")}` : undefined,
    connectivityKeys.length ? `connectivity_keys=${connectivityKeys.join(",")}` : undefined,
    endpoints.length ? `endpoints=${endpoints.join(",")}` : undefined,
  ].filter((detail): detail is string => Boolean(detail))

  return { kind: "net", label, summary: `${label} · via ${portLabel(index, sourcePort)}`, details }
}

export function pickPcbRegion(bounds: PcbRegionBounds): PcbAgentSelection | null {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return null
  const minX = Math.min(bounds.minX, bounds.maxX)
  const maxX = Math.max(bounds.minX, bounds.maxX)
  const minY = Math.min(bounds.minY, bounds.maxY)
  const maxY = Math.max(bounds.minY, bounds.maxY)
  if (minX === maxX || minY === maxY) return null
  const width = maxX - minX
  const height = maxY - minY
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const summary = `${fixed(width)} × ${fixed(height)} mm · center (${fixed(centerX)}, ${fixed(centerY)})`
  return {
    kind: "region",
    label: "layout region",
    summary,
    details: [
      `bounds_mm=min=(${fixed(minX)},${fixed(minY)}) max=(${fixed(maxX)},${fixed(maxY)})`,
      `center_mm=(${fixed(centerX)},${fixed(centerY)})`,
      `size_mm=(${fixed(width)},${fixed(height)})`,
      "coordinate_frame=pcb_xy",
      "selection_quality=viewer-axis-aligned-bounds",
    ],
  }
}

export function createPcbSelectionHandoff(projectID: string, directory: string, selection: PcbAgentSelection): AgentHandoffRequest {
  const title = selection.kind === "component" ? `PCB component ${selection.label}` : selection.kind === "net" ? `PCB net ${selection.label}` : "PCB layout region"
  return {
    text: `Inspect the selected ${selection.kind === "region" ? "PCB layout region" : `${selection.kind} "${selection.label}"`} in project ${projectID}. Propose the smallest source change and do not edit generated artifacts.`,
    source: "pcb",
    directory,
    paths: [directory],
    annotation: [title, `project_id=${projectID}`, ...selection.details].join("\n"),
    open: true,
    copyFallback: true,
  }
}
