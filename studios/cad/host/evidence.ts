import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export const EVIDENCE_DIR = "evidence/records"

export type EvidenceAxis = "requirement" | "printability" | "interface"

export type EvidenceFinding = { severity: "warning" | "error"; message: string }

export type EvidenceV1 = {
  schema: 1
  id: string
  axis: EvidenceAxis
  buildRevision: string
  contractHash: string
  subjects: string[]
  requirementId?: string
  interfaceId?: string
  status: "pass" | "fail"
  findings: EvidenceFinding[]
  recordedAt: number
}

export class EvidenceError extends Error {}

function validateRecord(value: unknown): EvidenceV1 {
  if (typeof value !== "object" || value === null) throw new EvidenceError("evidence record must be an object")
  const obj = value as Record<string, unknown>
  if (obj.schema !== 1) throw new EvidenceError("evidence record must use schema 1")
  for (const key of ["id", "buildRevision", "contractHash"] as const) {
    if (typeof obj[key] !== "string" || obj[key].length === 0) throw new EvidenceError(`evidence record missing ${key}`)
  }
  const axis = obj.axis
  if (axis !== "requirement" && axis !== "printability" && axis !== "interface") {
    throw new EvidenceError("evidence axis must be requirement, printability, or interface")
  }
  if (obj.status !== "pass" && obj.status !== "fail") throw new EvidenceError("evidence status must be pass or fail")
  if (typeof obj.recordedAt !== "number" || !Number.isFinite(obj.recordedAt)) {
    throw new EvidenceError("evidence record missing recordedAt")
  }
  if (!Array.isArray(obj.subjects) || obj.subjects.some((item) => typeof item !== "string")) {
    throw new EvidenceError("evidence subjects must be a string array")
  }
  if (!Array.isArray(obj.findings) || obj.findings.some((item) => !item || typeof item !== "object")) {
    throw new EvidenceError("evidence findings must be an array")
  }
  for (const finding of obj.findings as Array<Record<string, unknown>>) {
    if (
      (finding.severity !== "warning" && finding.severity !== "error") ||
      typeof finding.message !== "string" ||
      finding.message.length === 0
    ) {
      throw new EvidenceError("evidence finding must have severity warning/error and a message")
    }
  }
  return value as EvidenceV1
}

export async function writeEvidenceRecord(designDir: string, record: Omit<EvidenceV1, "schema" | "recordedAt">): Promise<EvidenceV1> {
  const dir = path.join(designDir, EVIDENCE_DIR)
  await mkdir(dir, { recursive: true })
  const full: EvidenceV1 = { schema: 1, ...record, recordedAt: Date.now() }
  await writeFile(path.join(dir, `${record.id}.json`), `${JSON.stringify(full, null, 2)}\n`, "utf8")
  return full
}

export async function listEvidenceRecords(designDir: string): Promise<EvidenceV1[]> {
  const dir = path.join(designDir, EVIDENCE_DIR)
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const records: EvidenceV1[] = []
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    try {
      records.push(validateRecord(JSON.parse(await readFile(path.join(dir, name), "utf8"))))
    } catch {
      // Ignore malformed records; they are not evidence.
    }
  }
  return records
}

/**
 * Latest records whose buildRevision and contractHash match the current build.
 * Anything else (stale revision, different contract) is ignored.
 */
export async function currentEvidence(designDir: string, buildRevision: string, contractHash: string): Promise<EvidenceV1[]> {
  const all = await listEvidenceRecords(designDir)
  return all.filter((record) => record.buildRevision === buildRevision && record.contractHash === contractHash)
}

export function latestByKey(records: EvidenceV1[], key: (record: EvidenceV1) => string | undefined): EvidenceV1[] {
  const latest = new Map<string, EvidenceV1>()
  for (const record of records) {
    const id = key(record)
    if (!id) continue
    const existing = latest.get(id)
    if (!existing || record.recordedAt > existing.recordedAt) latest.set(id, record)
  }
  return [...latest.values()]
}
