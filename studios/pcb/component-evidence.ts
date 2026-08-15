import { createHash } from "node:crypto"
import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { atomicWriteJson, isInside, readRegularFileAt } from "../../src/core/paths"

type Element = Record<string, unknown>

export const COMPONENT_EVIDENCE_SCHEMA = 1 as const
export const MAX_COMPONENT_EVIDENCE_BYTES = 512 * 1024
export const MAX_COMPONENT_EVIDENCE_RECORDS = 256
export const DEFAULT_COMPONENT_EVIDENCE_PATH = ".opencode-studio/component-evidence.json"

export type PackageProvenance = {
  spec: string
  version: string
  export: string
}

export type ComponentIdentityDocument = {
  schema: 1
  componentType: string
  manufacturer?: string
  manufacturerPartNumber?: string
  suppliers: Array<{ supplier: string; partNumbers: string[] }>
}

export type ComponentInterfaceDocument = {
  schema: 1
  pins: Array<{
    name: string
    aliases: string[]
    electrical: Record<string, boolean | number | string>
    pcbPorts: Array<{ pads: string[] }>
  }>
}

export type ComponentFootprintDocument = {
  schema: 1
  pads: Array<{
    pin: string
    kind: string
    x: number
    y: number
    rotation?: number
    shape?: string
    layers?: string[]
    width?: number
    height?: number
    radius?: number
    outerDiameter?: number
    holeDiameter?: number
  }>
}

export type ComponentFingerprint = {
  identity: ComponentIdentityDocument
  interface: ComponentInterfaceDocument
  footprint: ComponentFootprintDocument
  digests: { identity: string; interface: string; footprint: string; implementation: string }
}

export type ComponentEvidenceRecord = ComponentFingerprint & {
  package: PackageProvenance
}

export type ComponentEvidenceFile = {
  schema: 1
  records: ComponentEvidenceRecord[]
}

export type ComponentEvidenceMatch = {
  refdes: string
  matched: boolean
  evidence?: ComponentEvidenceRecord
  mismatches: Array<"identity" | "interface" | "footprint">
}

const PAD_TYPES = new Set(["pcb_smtpad", "pcb_plated_hole", "pcb_pad"])
const ELECTRICAL_FIELDS = new Set([
  "can_pin",
  "do_not_connect",
  "electrical_type",
  "is_bidir",
  "is_clock",
  "is_ground",
  "is_input",
  "is_inverted",
  "is_output",
  "is_power",
  "pin_type",
])

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function id(element: Element, type: string): string | undefined {
  return text(element[`${type}_id`])
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256Document(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function quantize(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Component geometry contains a non-finite number")
  const result = Math.round(value * 10_000) / 10_000
  return Object.is(result, -0) ? 0 : result
}

function point(element: Element): { x: number; y: number } | undefined {
  if (typeof element.x === "number" && typeof element.y === "number") return { x: element.x, y: element.y }
  const center = element.center
  if (!center || typeof center !== "object" || Array.isArray(center)) return undefined
  const { x, y } = center as Element
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined
}

function numberField(element: Element, ...fields: string[]): number | undefined {
  for (const field of fields) if (typeof element[field] === "number") return quantize(element[field] as number)
  return undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? sortedUnique(value.map(text).filter((item): item is string => item !== undefined)) : []
}

function padIdsForPort(port: Element): Set<string> {
  const result = new Set<string>()
  for (const [field, value] of Object.entries(port)) {
    if ((field.endsWith("pad_id") || field === "pcb_plated_hole_id") && text(value)) result.add(text(value)!)
    if (field.endsWith("pad_ids") && Array.isArray(value)) for (const entry of value) if (text(entry)) result.add(text(entry)!)
  }
  return result
}

function padsForPort(elements: Element[], port: Element): Element[] {
  const portId = id(port, "pcb_port")
  const explicitPadIds = padIdsForPort(port)
  return elements.filter((element) => {
    if (!PAD_TYPES.has(text(element.type) ?? "")) return false
    if (portId && element.pcb_port_id === portId) return true
    const elementId = text(element[`${element.type}_id`])
    return !!elementId && explicitPadIds.has(elementId)
  })
}

function rawPad(pad: Element, pin: string, origin: { x: number; y: number }) {
  const center = point(pad)
  if (!center) throw new Error(`Physical pad for pin '${pin}' has no center`)
  const result = {
    pin,
    kind: text(pad.type)!,
    x: quantize(center.x - origin.x),
    y: quantize(center.y - origin.y),
    rotation: numberField(pad, "rotation"),
    shape: text(pad.shape),
    layers: stringList(pad.layers),
    width: numberField(pad, "width"),
    height: numberField(pad, "height"),
    radius: numberField(pad, "radius"),
    outerDiameter: numberField(pad, "outer_diameter", "outerDiameter"),
    holeDiameter: numberField(pad, "hole_diameter", "holeDiameter"),
  }
  if (result.layers.length === 0) delete (result as Partial<typeof result>).layers
  return result
}

function rotatePad(pad: ReturnType<typeof rawPad>, quarterTurns: number) {
  let x = pad.x
  let y = pad.y
  for (let turn = 0; turn < quarterTurns; turn++) [x, y] = [-y, x]
  const rotation = pad.rotation === undefined ? undefined : quantize((((pad.rotation + quarterTurns * 90) % 360) + 360) % 360)
  return { ...pad, x: quantize(x), y: quantize(y), rotation }
}

function canonicalFootprint(pads: ReturnType<typeof rawPad>[]): { document: ComponentFootprintDocument; quarterTurns: number } {
  const candidates = [0, 1, 2, 3].map((turn) => {
    const rotated = pads.map((pad) => rotatePad(pad, turn)).sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1))
    return { document: { schema: 1 as const, pads: rotated }, quarterTurns: turn }
  })
  return candidates.sort((a, b) => (canonicalJson(a.document) < canonicalJson(b.document) ? -1 : 1))[0]!
}

function componentForRefdes(elements: Element[], refdes: string): Element {
  const matches = elements.filter((element) => element.type === "source_component" && text(element.name) === refdes)
  if (matches.length !== 1) throw new Error(`Expected exactly one source component with refdes '${refdes}', found ${matches.length}`)
  return matches[0]!
}

function identityDocument(component: Element): ComponentIdentityDocument {
  const supplierValue = component.supplier_part_numbers
  const suppliers =
    supplierValue && typeof supplierValue === "object" && !Array.isArray(supplierValue)
      ? Object.entries(supplierValue as Record<string, unknown>)
          .map(([supplier, values]) => ({ supplier: supplier.trim(), partNumbers: stringList(values) }))
          .filter((entry) => entry.supplier && entry.partNumbers.length > 0)
          .sort((a, b) => (a.supplier < b.supplier ? -1 : a.supplier > b.supplier ? 1 : 0))
      : []
  return {
    schema: 1,
    componentType: text(component.ftype) ?? "unknown",
    manufacturer: text(component.manufacturer),
    manufacturerPartNumber: text(component.manufacturer_part_number),
    suppliers,
  }
}

export function fingerprintComponent(circuitJson: unknown, refdes: string): ComponentFingerprint {
  if (!Array.isArray(circuitJson)) throw new Error("Circuit JSON must be an array")
  const elements = circuitJson.filter((entry): entry is Element => !!entry && typeof entry === "object" && !Array.isArray(entry))
  if (elements.length !== circuitJson.length) throw new Error("Circuit JSON contains a non-object element")
  const component = componentForRefdes(elements, refdes)
  const componentId = id(component, "source_component")
  if (!componentId) throw new Error(`Component '${refdes}' has no source_component_id`)
  const pcbComponents = elements.filter((entry) => entry.type === "pcb_component" && entry.source_component_id === componentId)
  if (pcbComponents.length !== 1) throw new Error(`Component '${refdes}' must map to exactly one PCB component`)
  const pcbComponent = pcbComponents[0]!
  const pcbComponentId = id(pcbComponent, "pcb_component")
  const origin = point(pcbComponent)
  if (!pcbComponentId || !origin) throw new Error(`PCB component for '${refdes}' is missing its id or center`)

  const sourcePorts = elements.filter((entry) => entry.type === "source_port" && entry.source_component_id === componentId)
  if (sourcePorts.length === 0) throw new Error(`Component '${refdes}' has no source pins`)
  const allPads: ReturnType<typeof rawPad>[] = []
  const pins = sourcePorts.map((sourcePort) => {
    const sourcePortId = id(sourcePort, "source_port")
    const name = text(sourcePort.name)
    if (!sourcePortId || !name) throw new Error(`Component '${refdes}' has a source pin without an id or name`)
    const pcbPorts = elements.filter(
      (entry) => entry.type === "pcb_port" && entry.source_port_id === sourcePortId && entry.pcb_component_id === pcbComponentId,
    )
    if (pcbPorts.length === 0) throw new Error(`Source pin '${refdes}.${name}' has no PCB-port mapping`)
    const mappedPorts = pcbPorts.map((pcbPort) => {
      const pads = padsForPort(elements, pcbPort)
      if (pads.length === 0) throw new Error(`PCB port for source pin '${refdes}.${name}' has no physical pad mapping`)
      const documents = pads.map((pad) => rawPad(pad, name, origin))
      allPads.push(...documents)
      return { pads: documents }
    })
    const electrical = Object.fromEntries(
      Object.entries(sourcePort)
        .filter(([field, value]) => ELECTRICAL_FIELDS.has(field) && ["boolean", "number", "string"].includes(typeof value))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ) as Record<string, boolean | number | string>
    return {
      name,
      aliases: sortedUnique(stringList(sourcePort.port_hints).filter((alias) => alias !== name)),
      electrical,
      pcbPorts: mappedPorts,
    }
  })
  pins.sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1))

  const identity = identityDocument(component)
  const canonical = canonicalFootprint(allPads)
  const footprint = canonical.document
  const interfacePins = pins.map((pin) => ({
    name: pin.name,
    aliases: pin.aliases,
    electrical: pin.electrical,
    pcbPorts: pin.pcbPorts
      .map((port) => ({ pads: port.pads.map((pad) => canonicalJson(rotatePad(pad, canonical.quarterTurns))).sort() }))
      .sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1)),
  }))
  interfacePins.sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1))
  const interfaceDocument: ComponentInterfaceDocument = {
    schema: 1,
    pins: interfacePins,
  }
  const digests = {
    identity: sha256Document(identity),
    interface: sha256Document(interfaceDocument),
    footprint: sha256Document(footprint),
    implementation: "",
  }
  digests.implementation = sha256Document(digests)
  return { identity, interface: interfaceDocument, footprint, digests }
}

function validPackage(value: PackageProvenance): void {
  if (!value || typeof value !== "object") throw new Error("Evidence package provenance must be an object")
  for (const field of ["spec", "version", "export"] as const) {
    if (!text(value[field]) || value[field].length > 512) throw new Error(`Evidence package ${field} must be a non-empty bounded string`)
  }
}

export function createComponentEvidence(
  circuitJson: unknown,
  refdes: string,
  packageProvenance: PackageProvenance,
): ComponentEvidenceRecord {
  validPackage(packageProvenance)
  return { package: { ...packageProvenance }, ...fingerprintComponent(circuitJson, refdes) }
}

function validateRecord(record: ComponentEvidenceRecord): void {
  if (!record || typeof record !== "object") throw new Error("Invalid component evidence record")
  validPackage(record.package)
  if (record.identity?.schema !== 1 || record.interface?.schema !== 1 || record.footprint?.schema !== 1) {
    throw new Error("Unsupported component fingerprint document schema")
  }
  if (!Array.isArray(record.identity.suppliers) || !Array.isArray(record.interface.pins) || !Array.isArray(record.footprint.pads)) {
    throw new Error("Invalid component fingerprint document")
  }
  const expected = {
    identity: sha256Document(record.identity),
    interface: sha256Document(record.interface),
    footprint: sha256Document(record.footprint),
    implementation: "",
  }
  expected.implementation = sha256Document(expected)
  if (canonicalJson(expected) !== canonicalJson(record.digests)) throw new Error("Component evidence digest verification failed")
}

function validateFile(value: unknown): ComponentEvidenceFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Component evidence must be an object")
  const file = value as ComponentEvidenceFile
  if (file.schema !== COMPONENT_EVIDENCE_SCHEMA) throw new Error(`Unsupported component evidence schema: ${String(file.schema)}`)
  if (!Array.isArray(file.records) || file.records.length > MAX_COMPONENT_EVIDENCE_RECORDS) {
    throw new Error(`Component evidence records must be an array of at most ${MAX_COMPONENT_EVIDENCE_RECORDS}`)
  }
  for (const record of file.records) validateRecord(record)
  return file
}

async function safeEvidencePath(
  projectRoot: string,
  relativePath: string,
  createParents: boolean,
): Promise<{ root: string; target: string }> {
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath))
    throw new Error("Evidence path must be project-relative")
  const rootInfo = await lstat(projectRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Project root must be a regular directory, not a symlink")
  const root = await realpath(projectRoot)
  const target = path.resolve(root, relativePath)
  if (!isInside(root, target) || target === root) throw new Error("Evidence path escapes project root")
  const parentRelative = path.relative(root, path.dirname(target))
  let current = root
  for (const segment of parentRelative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Evidence path contains a symlink or non-directory")
    } catch (error) {
      if (!createParents || (error instanceof Error && !error.message.includes("ENOENT"))) throw error
      await mkdir(current, { mode: 0o700 })
    }
  }
  try {
    const targetInfo = await lstat(target)
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) throw new Error("Evidence target must be a regular file, not a symlink")
  } catch (error) {
    if (!createParents || (error instanceof Error && !error.message.includes("ENOENT"))) throw error
  }
  return { root, target }
}

export async function readComponentEvidence(
  projectRoot: string,
  relativePath = DEFAULT_COMPONENT_EVIDENCE_PATH,
): Promise<ComponentEvidenceFile> {
  const { root, target } = await safeEvidencePath(projectRoot, relativePath, false)
  const info = await lstat(target)
  if (info.size > MAX_COMPONENT_EVIDENCE_BYTES) throw new Error(`Component evidence exceeds ${MAX_COMPONENT_EVIDENCE_BYTES} bytes`)
  const buffer = await readRegularFileAt(root, target)
  if (buffer.byteLength > MAX_COMPONENT_EVIDENCE_BYTES) throw new Error(`Component evidence exceeds ${MAX_COMPONENT_EVIDENCE_BYTES} bytes`)
  return validateFile(JSON.parse(buffer.toString("utf8")))
}

export async function writeComponentEvidence(
  projectRoot: string,
  evidence: ComponentEvidenceFile,
  relativePath = DEFAULT_COMPONENT_EVIDENCE_PATH,
): Promise<string> {
  validateFile(evidence)
  const encoded = `${JSON.stringify(evidence, null, 2)}\n`
  if (Buffer.byteLength(encoded) > MAX_COMPONENT_EVIDENCE_BYTES)
    throw new Error(`Component evidence exceeds ${MAX_COMPONENT_EVIDENCE_BYTES} bytes`)
  const { root, target } = await safeEvidencePath(projectRoot, relativePath, true)
  await atomicWriteJson(target, evidence, { root })
  return target
}

export function matchComplexComponentInstances(
  circuitJson: unknown,
  evidence: readonly ComponentEvidenceRecord[],
): ComponentEvidenceMatch[] {
  for (const record of evidence) validateRecord(record)
  if (!Array.isArray(circuitJson)) throw new Error("Circuit JSON must be an array")
  const complexRefdes = circuitJson
    .filter(
      (entry): entry is Element =>
        !!entry && typeof entry === "object" && !Array.isArray(entry) && entry.type === "source_component" && entry.ftype === "complex",
    )
    .map((entry) => text(entry.name))
    .filter((entry): entry is string => entry !== undefined)
    .sort()
  return complexRefdes.map((refdes) => {
    const actual = fingerprintComponent(circuitJson, refdes)
    const matched = evidence.find((record) => record.digests.implementation === actual.digests.implementation)
    if (matched) return { refdes, matched: true, evidence: matched, mismatches: [] }
    const closest = evidence
      .map((record) => ({
        record,
        mismatches: (["identity", "interface", "footprint"] as const).filter((kind) => record.digests[kind] !== actual.digests[kind]),
      }))
      .sort((a, b) => a.mismatches.length - b.mismatches.length)[0]
    return { refdes, matched: false, evidence: closest?.record, mismatches: closest?.mismatches ?? ["identity", "interface", "footprint"] }
  })
}
