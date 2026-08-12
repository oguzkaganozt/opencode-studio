import type { CadToolStatus } from "../tools/result"

export type QcEvidenceAxis = "printability" | "fit" | "form" | "validate"

export type QcEvidenceRecord = {
  axis: QcEvidenceAxis
  tool: string
  ok: boolean
  status: CadToolStatus
  summary: string
  recordedAt: number
  designId: string
  /** Build revision when known. */
  revision?: string | null
  /** Object / pair labels from the tool args. */
  subjects?: string[]
}

const ledger = new Map<string, QcEvidenceRecord[]>()
/** sessionKey (engine::cwd) → active design id for session tool recording */
const activeDesign = new Map<string, string>()

export function qcSessionKey(engineProjectDir: string, cwd: string): string {
  return `${engineProjectDir}::${cwd}`
}

export function qcEvidenceKey(engineProjectDir: string, cwd: string, designId: string): string {
  return `${qcSessionKey(engineProjectDir, cwd)}::${designId}`
}

export function setActiveQcDesign(sessionKey: string, designId: string): void {
  activeDesign.set(sessionKey, designId)
}

export function getActiveQcDesign(sessionKey: string): string | undefined {
  return activeDesign.get(sessionKey)
}

export function recordQcEvidence(
  sessionKey: string,
  evidence: Omit<QcEvidenceRecord, "recordedAt" | "designId"> & { designId?: string },
): boolean {
  const designId = evidence.designId ?? activeDesign.get(sessionKey)
  if (!designId) return false
  const key = `${sessionKey}::${designId}`
  const row: QcEvidenceRecord = {
    ...evidence,
    designId,
    recordedAt: Date.now(),
  }
  const list = ledger.get(key) ?? []
  const subjectsKey = (row.subjects ?? []).join(",")
  const next = list.filter(
    (item) => !(item.axis === row.axis && item.tool === row.tool && (item.subjects ?? []).join(",") === subjectsKey),
  )
  next.push(row)
  ledger.set(key, next.slice(-60))
  return true
}

export function clearQcEvidenceForDesign(sessionKey: string, designId: string): void {
  ledger.delete(`${sessionKey}::${designId}`)
}

/** @deprecated use clearQcEvidenceForDesign */
export function clearQcEvidence(key: string): void {
  ledger.delete(key)
}

export function listQcEvidence(designKey: string, axis: QcEvidenceAxis): QcEvidenceRecord[] {
  return (ledger.get(designKey) ?? []).filter((row) => row.axis === axis)
}

export function latestQcEvidence(
  designKey: string,
  axis: QcEvidenceAxis,
  options?: { revision?: string | null; tool?: string },
): QcEvidenceRecord | null {
  const list = listQcEvidence(designKey, axis)
  const revision = options?.revision
  for (let i = list.length - 1; i >= 0; i--) {
    const row = list[i]!
    if (options?.tool && row.tool !== options.tool) continue
    if (revision != null && row.revision != null && row.revision !== revision) continue
    return row
  }
  return null
}

/**
 * Normalize session object names toward design part ids.
 * body_built / base_print / trim_left_print_side / trim-left → matching stem.
 */
export function normalizeSubject(name: string): string {
  let s = name.trim().toLowerCase().replace(/-/g, "_")
  // Strip pose/import suffixes repeatedly (…_print_side → …_print → stem).
  let prev = ""
  while (s !== prev) {
    prev = s
    s = s.replace(/(_built|_print|_bed|_assembled|_asm|_pose|_side|_viz)$/i, "")
  }
  return s
}

export function subjectsCoverParts(subjects: string[], partIds: string[]): { ok: boolean; missing: string[] } {
  if (partIds.length === 0) return { ok: true, missing: [] }
  const normalized = new Set(subjects.map(normalizeSubject).filter(Boolean))
  // current_shape alone cannot cover multi-part
  const missing = partIds.filter((id) => {
    const n = normalizeSubject(id)
    return !normalized.has(n) && ![...normalized].some((s) => s === n || s.startsWith(`${n}_`) || n.startsWith(`${s}_`))
  })
  return { ok: missing.length === 0, missing }
}

/** Map structured session tool results into QC axes. */
export function axisForSessionTool(entryName: string, args?: Record<string, unknown>): QcEvidenceAxis | null {
  if (entryName === "analyze_printability") return "printability"
  if (entryName === "compare") {
    const kind = String(args?.kind ?? "shape").toLowerCase()
    // Fit gate requires clearance/interpenetration evidence — align alone is not enough.
    if (kind === "fit") return "fit"
    return null
  }
  if (entryName === "validate") return "validate"
  return null
}

export function subjectsFromArgs(entryName: string, args?: Record<string, unknown>): string[] {
  if (!args) return []
  if (entryName === "analyze_printability" || entryName === "validate") {
    const name = typeof args.object_name === "string" ? args.object_name.trim() : ""
    return name ? [name] : ["current_shape"]
  }
  if (entryName === "compare") {
    const a = typeof args.a === "string" ? args.a : ""
    const b = typeof args.b === "string" ? args.b : ""
    return [a, b].filter(Boolean)
  }
  return []
}
