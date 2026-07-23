export type Evidence = {
  url: string
  date?: string
  engagement?: string
  summary: string
}

export type Rubric = {
  pain: number
  payment: number
  shelf: number
  freshness: number
  fit: number
}

export type Evaluation = {
  pros: string
  cons: string
  risks: string
  recommendation: string
  updated_at: string
}

export type PoolEntry = {
  name: string
  problem: string
  buyer: string
  shelf: string
  signal_class: "A" | "B"
  evidence: Evidence[]
  verdict: "verified" | "partial" | "unverified"
  verify_summary?: string
  total: number
  rubric: Rubric
  one_liner: string
  status: string
  batch: string
  first_seen: string
  evaluation?: Evaluation
}

export type RejectEntry = {
  name: string
  problem: string
  buyer?: string
  reason: string
  batch: string
  first_seen: string
}

export type CandidateSummary = {
  name: string
  total: number
  signal_class: "A" | "B"
  verdict: PoolEntry["verdict"]
  one_liner: string
  buyer: string
  shelf: string
  first_seen: string
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function assertCandidateName(name: string) {
  if (!NAME_RE.test(name) || name.length > 64) {
    throw new Error(`Invalid candidate name (kebab-case slug, max 64): ${name}`)
  }
}

function clampScore(n: number, label: string) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 2) {
    throw new Error(`Invalid rubric.${label}: must be 0–2`)
  }
  return n
}

/** Validate an http(s) evidence URL; rejects javascript:, data:, and other schemes. */
export function normalizeEvidenceUrl(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("evidence url required")
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("evidence url must be http(s)")
    }
    return url.toString()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("evidence url")) throw error
    throw new Error("evidence url must be a valid http(s) URL")
  }
}

export function normalizePoolEntry(raw: unknown): PoolEntry {
  if (!raw || typeof raw !== "object") throw new Error("Pool entry must be an object")
  const o = raw as Record<string, unknown>
  assertCandidateName(String(o.name ?? ""))
  const signal = o.signal_class
  if (signal !== "A" && signal !== "B") throw new Error("signal_class must be A or B")
  const verdict = o.verdict
  if (verdict !== "verified" && verdict !== "partial" && verdict !== "unverified") {
    throw new Error("verdict must be verified | partial | unverified")
  }
  if (!Array.isArray(o.evidence) || o.evidence.length < 1 || o.evidence.length > 8) {
    throw new Error("evidence must be an array of 1–8 items")
  }
  const evidence: Evidence[] = o.evidence.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`evidence[${i}] invalid`)
    const e = item as Record<string, unknown>
    const url = normalizeEvidenceUrl(String(e.url ?? ""))
    if (typeof e.summary !== "string") throw new Error(`evidence[${i}].summary required`)
    return {
      url,
      summary: e.summary,
      ...(typeof e.date === "string" ? { date: e.date } : {}),
      ...(typeof e.engagement === "string" ? { engagement: e.engagement } : {}),
    }
  })
  const rubricRaw = o.rubric
  if (!rubricRaw || typeof rubricRaw !== "object") throw new Error("rubric required")
  const r = rubricRaw as Record<string, unknown>
  const rubric: Rubric = {
    pain: clampScore(Number(r.pain), "pain"),
    payment: clampScore(Number(r.payment), "payment"),
    shelf: clampScore(Number(r.shelf), "shelf"),
    freshness: clampScore(Number(r.freshness), "freshness"),
    fit: clampScore(Number(r.fit), "fit"),
  }
  const total =
    typeof o.total === "number" && Number.isFinite(o.total)
      ? o.total
      : rubric.pain + rubric.payment + rubric.shelf + rubric.freshness + rubric.fit
  if (total < 0 || total > 10) throw new Error("total must be 0–10")

  let evaluation: Evaluation | undefined
  if (o.evaluation !== undefined) {
    if (!o.evaluation || typeof o.evaluation !== "object") throw new Error("evaluation invalid")
    const ev = o.evaluation as Record<string, unknown>
    for (const key of ["pros", "cons", "risks", "recommendation", "updated_at"] as const) {
      if (typeof ev[key] !== "string" || !ev[key]) throw new Error(`evaluation.${key} required`)
    }
    evaluation = {
      pros: ev.pros as string,
      cons: ev.cons as string,
      risks: ev.risks as string,
      recommendation: ev.recommendation as string,
      updated_at: ev.updated_at as string,
    }
  }

  for (const key of ["problem", "buyer", "shelf", "one_liner", "batch", "first_seen"] as const) {
    if (typeof o[key] !== "string" || !(o[key] as string).trim()) {
      throw new Error(`${key} required`)
    }
  }

  return {
    name: o.name as string,
    problem: o.problem as string,
    buyer: o.buyer as string,
    shelf: o.shelf as string,
    signal_class: signal,
    evidence,
    verdict,
    ...(typeof o.verify_summary === "string" ? { verify_summary: o.verify_summary } : {}),
    total,
    rubric,
    one_liner: o.one_liner as string,
    status: typeof o.status === "string" && o.status ? o.status : "pool",
    batch: o.batch as string,
    first_seen: o.first_seen as string,
    ...(evaluation ? { evaluation } : {}),
  }
}

export function normalizeRejectEntry(raw: unknown): RejectEntry {
  if (!raw || typeof raw !== "object") throw new Error("Reject entry must be an object")
  const o = raw as Record<string, unknown>
  assertCandidateName(String(o.name ?? ""))
  if (typeof o.problem !== "string" || !o.problem.trim()) throw new Error("problem required")
  if (typeof o.reason !== "string" || !o.reason.trim()) throw new Error("reason required")
  if (typeof o.batch !== "string" || !o.batch.trim()) throw new Error("batch required")
  if (typeof o.first_seen !== "string" || !o.first_seen.trim()) throw new Error("first_seen required")
  return {
    name: o.name as string,
    problem: o.problem as string,
    reason: o.reason as string,
    batch: o.batch as string,
    first_seen: o.first_seen as string,
    ...(typeof o.buyer === "string" ? { buyer: o.buyer } : {}),
  }
}

export function toSummary(entry: PoolEntry): CandidateSummary {
  return {
    name: entry.name,
    total: entry.total,
    signal_class: entry.signal_class,
    verdict: entry.verdict,
    one_liner: entry.one_liner,
    buyer: entry.buyer,
    shelf: entry.shelf,
    first_seen: entry.first_seen,
  }
}
