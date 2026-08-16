export type CourtyardSize = {
  widthMm: number
  heightMm: number
}

type Box = { minX: number; minY: number; maxX: number; maxY: number }

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function point(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const { x, y } = value as { x?: unknown; y?: unknown }
  const px = finite(x)
  const py = finite(y)
  return px !== undefined && py !== undefined ? { x: px, y: py } : undefined
}

function quantize(value: number): number {
  return Math.round(value * 10) / 10
}

function union(boxes: Box[]): Box | undefined {
  if (boxes.length === 0) return
  return boxes.reduce((acc, box) => ({
    minX: Math.min(acc.minX, box.minX),
    minY: Math.min(acc.minY, box.minY),
    maxX: Math.max(acc.maxX, box.maxX),
    maxY: Math.max(acc.maxY, box.maxY),
  }))
}

function boxFromSize(center: { x: number; y: number }, width: number, height: number, rotationDeg?: number): Box | undefined {
  if (!(width > 0) || !(height > 0)) return
  const turns = rotationDeg === undefined ? 0 : Math.abs(rotationDeg) % 180
  const swap = turns > 45 && turns < 135
  const w = swap ? height : width
  const h = swap ? width : height
  return { minX: center.x - w / 2, minY: center.y - h / 2, maxX: center.x + w / 2, maxY: center.y + h / 2 }
}

function boxFromPoints(values: unknown): Box | undefined {
  if (!Array.isArray(values)) return
  const pts = values.map(point).filter((item): item is { x: number; y: number } => item !== undefined)
  if (pts.length === 0) return
  return {
    minX: Math.min(...pts.map((item) => item.x)),
    minY: Math.min(...pts.map((item) => item.y)),
    maxX: Math.max(...pts.map((item) => item.x)),
    maxY: Math.max(...pts.map((item) => item.y)),
  }
}

function courtyardBox(element: Record<string, unknown>): Box | undefined {
  const type = element.type
  const center = point(element.center)
  const rotation = finite(element.ccw_rotation) ?? finite(element.rotation)
  if (type === "pcb_courtyard_rect" || type === "pcb_courtyard_pill") {
    const width = finite(element.width)
    const height = finite(element.height)
    if (!center || width === undefined || height === undefined) return
    return boxFromSize(center, width, height, rotation)
  }
  if (type === "pcb_courtyard_circle") {
    const radius = finite(element.radius)
    if (!center || radius === undefined) return
    return boxFromSize(center, radius * 2, radius * 2)
  }
  if (type === "pcb_courtyard_polygon") return boxFromPoints(element.points)
  if (type === "pcb_courtyard_outline") return boxFromPoints(element.outline)
}

function componentBox(element: Record<string, unknown>): Box | undefined {
  const center = point(element.center)
  const width = finite(element.width)
  const height = finite(element.height)
  if (!center || width === undefined || height === undefined) return
  return boxFromSize(center, width, height, finite(element.rotation))
}

export function measureComponentCourtyard(circuitJson: unknown, refdes: string): CourtyardSize | undefined {
  if (!Array.isArray(circuitJson)) return
  const elements = circuitJson.filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry),
  )
  const source = elements.find((entry) => entry.type === "source_component" && entry.name === refdes)
  const sourceId = typeof source?.source_component_id === "string" ? source.source_component_id : undefined
  if (!sourceId) return
  const boxes: Box[] = []
  for (const pcb of elements.filter((entry) => entry.type === "pcb_component" && entry.source_component_id === sourceId)) {
    const pcbId = typeof pcb.pcb_component_id === "string" ? pcb.pcb_component_id : undefined
    const courtyards = elements
      .filter((entry) => typeof entry.type === "string" && entry.type.startsWith("pcb_courtyard_") && entry.pcb_component_id === pcbId)
      .map(courtyardBox)
      .filter((box): box is Box => box !== undefined)
    if (courtyards.length > 0) boxes.push(...courtyards)
    else {
      const fallback = componentBox(pcb)
      if (fallback) boxes.push(fallback)
    }
  }
  const combined = union(boxes)
  if (!combined) return
  const widthMm = quantize(combined.maxX - combined.minX)
  const heightMm = quantize(combined.maxY - combined.minY)
  if (!(widthMm > 0) || !(heightMm > 0)) return
  return { widthMm, heightMm }
}
