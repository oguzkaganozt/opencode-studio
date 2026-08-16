import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export const ACCEPTANCE_FILE = "acceptance.json"
export const ACCEPTANCE_HISTORY_DIR = "acceptance/history"

export type AcceptanceBboxDim = {
  id: string
  kind: "bbox"
  artifactId: string
  measure: "size"
  axis: "X" | "Y" | "Z"
  targetMm: number
  toleranceMm: number
}

export type AcceptanceInterface = {
  id: string
  a: string
  b: string
  fit: "clearance" | "contact" | "interference"
  targetMm: number
  toleranceMm: number
}

export type AcceptanceV1 = {
  schema: 1
  state: "locked"
  authority: "harness" | "user"
  contractHash: string
  manufacturing: {
    process: "fdm"
    buildVolumeMm: [number, number, number]
    nozzleMm: number
    minimumWallMm: number
    bedToleranceMm: number
    defaultClearanceMm: number
  }
  dimensions: AcceptanceBboxDim[]
  interfaces: AcceptanceInterface[]
}

export type AcceptanceContract = Omit<AcceptanceV1, "contractHash">

export class AcceptanceError extends Error {}

function finitePositive(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new AcceptanceError(`${label} must be a finite positive number`)
  }
  return value
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AcceptanceError(`${label} must be a finite number`)
  return value
}

function finiteVector3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new AcceptanceError(`${label} must be an array of three finite numbers`)
  }
  return value as [number, number, number]
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AcceptanceError(`${label} must be an object`)
  return value as Record<string, unknown>
}

/** Canonical JSON: stable key order, no whitespace — the contractHash input. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    Array.isArray(item)
      ? item
      : typeof item === "object" && item !== null
        ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : item,
  )
}

/** Validate + normalize a raw contract (schema 1, no contractHash). */
export function normalizeAcceptanceContract(value: unknown): AcceptanceContract {
  const obj = requireObject(value, "acceptance")
  if (obj.schema !== 1) throw new AcceptanceError("acceptance must use schema 1")
  if (obj.state !== "locked") throw new AcceptanceError("acceptance state must be locked")
  const authority = obj.authority
  if (authority !== "harness" && authority !== "user") throw new AcceptanceError("acceptance authority must be harness or user")
  if (obj.contractHash !== undefined && obj.contractHash !== null) {
    throw new AcceptanceError("contractHash is computed by the host; omit it in the contract")
  }
  const manufacturing = requireObject(obj.manufacturing, "acceptance.manufacturing")
  if (manufacturing.process !== "fdm") throw new AcceptanceError("acceptance.manufacturing.process must be fdm")
  const buildVolumeMm = finiteVector3(manufacturing.buildVolumeMm, "acceptance.manufacturing.buildVolumeMm")
  const nozzleMm = finitePositive(manufacturing.nozzleMm, "acceptance.manufacturing.nozzleMm")
  const minimumWallMm = finitePositive(manufacturing.minimumWallMm, "acceptance.manufacturing.minimumWallMm")
  const bedToleranceMm = finitePositive(manufacturing.bedToleranceMm, "acceptance.manufacturing.bedToleranceMm")
  const defaultClearanceMm = finitePositive(manufacturing.defaultClearanceMm, "acceptance.manufacturing.defaultClearanceMm")

  const rawDims = obj.dimensions
  if (!Array.isArray(rawDims)) throw new AcceptanceError("acceptance.dimensions must be an array")
  const dimensionIds = new Set<string>()
  const dimensions: AcceptanceBboxDim[] = rawDims.map((raw, index) => {
    const dim = requireObject(raw, `acceptance.dimensions[${index}]`)
    if (dim.kind !== "bbox") throw new AcceptanceError(`acceptance.dimensions[${index}] kind must be bbox`)
    const id = dim.id
    if (typeof id !== "string" || id.length === 0) throw new AcceptanceError(`acceptance.dimensions[${index}] needs an id`)
    if (dimensionIds.has(id)) throw new AcceptanceError(`Duplicate dimension id: ${id}`)
    dimensionIds.add(id)
    const artifactId = dim.artifactId
    if (typeof artifactId !== "string" || artifactId.length === 0) {
      throw new AcceptanceError(`Dimension ${id} needs artifactId`)
    }
    const axis = dim.axis
    if (axis !== "X" && axis !== "Y" && axis !== "Z") throw new AcceptanceError(`Dimension ${id} axis must be X, Y, or Z`)
    return {
      id,
      kind: "bbox" as const,
      artifactId,
      measure: "size" as const,
      axis,
      targetMm: finitePositive(dim.targetMm, `Dimension ${id} targetMm`),
      toleranceMm: finitePositive(dim.toleranceMm, `Dimension ${id} toleranceMm`),
    }
  })

  const rawInterfaces = obj.interfaces
  if (!Array.isArray(rawInterfaces)) throw new AcceptanceError("acceptance.interfaces must be an array")
  const interfaceIds = new Set<string>()
  const interfaces: AcceptanceInterface[] = rawInterfaces.map((raw, index) => {
    const iface = requireObject(raw, `acceptance.interfaces[${index}]`)
    const id = iface.id
    if (typeof id !== "string" || id.length === 0) throw new AcceptanceError(`acceptance.interfaces[${index}] needs an id`)
    if (interfaceIds.has(id)) throw new AcceptanceError(`Duplicate interface id: ${id}`)
    interfaceIds.add(id)
    const fit = iface.fit
    if (fit !== "clearance" && fit !== "contact" && fit !== "interference") {
      throw new AcceptanceError(`Interface ${id} fit must be clearance, contact, or interference`)
    }
    const a = iface.a
    const b = iface.b
    if (typeof a !== "string" || a.length === 0 || typeof b !== "string" || b.length === 0 || a === b) {
      throw new AcceptanceError(`Interface ${id} needs distinct a and b artifact ids`)
    }
    return {
      id,
      a,
      b,
      fit,
      targetMm: finiteNumber(iface.targetMm, `Interface ${id} targetMm`),
      toleranceMm: finitePositive(iface.toleranceMm, `Interface ${id} toleranceMm`),
    }
  })

  return {
    schema: 1,
    state: "locked",
    authority,
    manufacturing: { process: "fdm", buildVolumeMm, nozzleMm, minimumWallMm, bedToleranceMm, defaultClearanceMm },
    dimensions,
    interfaces,
  }
}

export function contractHashOf(contract: AcceptanceContract): string {
  return createHash("sha256").update(canonicalJson(contract)).digest("hex")
}

export async function writeAcceptance(designDir: string, contract: AcceptanceContract): Promise<AcceptanceV1> {
  const hash = contractHashOf(contract)
  const acceptance: AcceptanceV1 = { ...contract, contractHash: hash }
  const activePath = path.join(designDir, ACCEPTANCE_FILE)
  const historyDir = path.join(designDir, ACCEPTANCE_HISTORY_DIR)
  await mkdir(historyDir, { recursive: true })
  await writeFile(activePath, `${JSON.stringify(acceptance, null, 2)}\n`, "utf8")
  await writeFile(path.join(historyDir, `${hash}.json`), `${JSON.stringify(acceptance, null, 2)}\n`, "utf8")
  return acceptance
}

export async function readAcceptance(designDir: string): Promise<AcceptanceV1> {
  let text: string
  try {
    text = await readFile(path.join(designDir, ACCEPTANCE_FILE), "utf8")
  } catch {
    throw new AcceptanceError(`Missing ${ACCEPTANCE_FILE}: ${path.join(designDir, ACCEPTANCE_FILE)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AcceptanceError(`Invalid JSON in ${ACCEPTANCE_FILE}`)
  }
  const obj = requireObject(parsed, "acceptance")
  if (obj.schema !== 1) throw new AcceptanceError("acceptance must use schema 1")
  if (obj.state !== "locked") throw new AcceptanceError("acceptance state must be locked")
  const contractHash = obj.contractHash
  if (typeof contractHash !== "string" || !/^[a-f0-9]{64}$/.test(contractHash)) {
    throw new AcceptanceError("acceptance contractHash must be a SHA-256 hex string")
  }
  const contract = normalizeAcceptanceContract({ ...obj, contractHash: undefined })
  if (contractHashOf(contract) !== contractHash) {
    throw new AcceptanceError("acceptance contractHash does not match its content")
  }
  return { ...contract, contractHash }
}
