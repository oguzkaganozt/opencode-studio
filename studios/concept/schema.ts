export const CONCEPT_ID = /^[a-z0-9][a-z0-9_-]*$/
export const CONCEPT_SCHEMA = 1
export const UPDATE_SECTIONS = ["intent", "context", "constraints", "requirements", "direction"] as const
export const VAGUE_MUST = /^(beautiful|nice|premium|elegant|modern|minimal)[.!]?\s*$/i

export type ConceptStatus = "draft" | "frozen"
export type UpdateSection = (typeof UPDATE_SECTIONS)[number]

export type Requirement = {
  id: string
  text: string
  testable: true
}

export type Direction = {
  id: string
  name: string
  form: string
  cmf: string
  rationale: string
}

export type MoodboardRef = {
  path: string
  direction_id: string
  prompt_hash: string
  provider: string
}

export type ConceptIntent = { one_liner: string; product_type: string }
export type ConceptContext = { user: string; environment: string; scenarios: string[] }
export type ConceptConstraints = {
  envelope_mm: [number, number, number] | null
  cost: string | null
  process: string | null
  brand: string | null
  other: string[]
}
export type ConceptRequirements = {
  must: Requirement[]
  should: Requirement[]
  could: Requirement[]
  out: string[]
}

export type Concept = {
  schema: 1
  id: string
  status: ConceptStatus
  revision: number
  intent: ConceptIntent | null
  context: ConceptContext | null
  constraints: ConceptConstraints | null
  requirements: ConceptRequirements | null
  directions: Direction[]
  chosen_direction: string | null
  moodboards: MoodboardRef[]
  frozen_at: string | null
  source_hash: string | null
}

export type ReviewSeverity = "blocker" | "weak" | "note"

export type ReviewFinding = {
  id: string
  severity: ReviewSeverity
  topic: string
  text: string
}

export type Review = {
  schema: 1
  concept_id: string
  concept_hash: string
  findings: ReviewFinding[]
}

export type FreezeWaive = { id: string; reason: string }

export function safeConceptId(value: string) {
  if (!CONCEPT_ID.test(value)) throw new Error("Invalid concept id")
  return value
}

export function emptyConcept(id: string, revision = 1): Concept {
  return {
    schema: CONCEPT_SCHEMA,
    id: safeConceptId(id),
    status: "draft",
    revision,
    intent: null,
    context: null,
    constraints: null,
    requirements: null,
    directions: [],
    chosen_direction: null,
    moodboards: [],
    frozen_at: null,
    source_hash: null,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}

function assertKnownKeys(row: Record<string, unknown>, keys: readonly string[], label: string) {
  const extra = Object.keys(row).filter((key) => !keys.includes(key))
  if (extra.length > 0) throw new Error(`Unknown ${label} keys: ${extra.join(", ")}`)
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function optionalString(value: unknown, label: string) {
  if (value == null) return null
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function stringList(value: unknown, label: string) {
  if (value == null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`)
  return value.map((item) => item.trim()).filter(Boolean)
}

export function isVagueMust(text: string) {
  return VAGUE_MUST.test(text.trim())
}

function parseRequirement(value: unknown, kind: string): Requirement {
  const row = asRecord(value)
  assertKnownKeys(row, ["id", "text", "testable"], kind)
  const text = requiredString(row.text, `${kind}.text`)
  if (row.testable !== true) throw new Error(`${kind} must set testable: true`)
  if (kind === "must" && isVagueMust(text)) throw new Error(`Vague must rejected: "${text}"`)
  return { id: requiredString(row.id, `${kind}.id`), text, testable: true }
}

function parseRequirements(value: unknown): ConceptRequirements {
  const row = asRecord(value)
  assertKnownKeys(row, ["must", "should", "could", "out"], "requirements")
  return {
    must: Array.isArray(row.must) ? row.must.map((item) => parseRequirement(item, "must")) : [],
    should: Array.isArray(row.should) ? row.should.map((item) => parseRequirement(item, "should")) : [],
    could: Array.isArray(row.could) ? row.could.map((item) => parseRequirement(item, "could")) : [],
    out: stringList(row.out, "out"),
  }
}

function parseDirection(value: unknown): Direction {
  const row = asRecord(value)
  assertKnownKeys(row, ["id", "name", "form", "cmf", "rationale", "chosen"], "direction")
  return {
    id: safeConceptId(requiredString(row.id, "direction.id")),
    name: requiredString(row.name, "direction.name"),
    form: requiredString(row.form, "direction.form"),
    cmf: requiredString(row.cmf, "direction.cmf"),
    rationale: requiredString(row.rationale, "direction.rationale"),
  }
}

function parseEnvelope(value: unknown): [number, number, number] | null {
  if (value == null) return null
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item) || item <= 0)
  ) {
    throw new Error("envelope_mm must be three positive numbers")
  }
  return [value[0] as number, value[1] as number, value[2] as number]
}

function parseMoodboard(value: unknown): MoodboardRef {
  const row = asRecord(value)
  return {
    path: requiredString(row.path, "moodboard.path"),
    direction_id: requiredString(row.direction_id, "moodboard.direction_id"),
    prompt_hash: requiredString(row.prompt_hash, "moodboard.prompt_hash"),
    provider: requiredString(row.provider, "moodboard.provider"),
  }
}

export function parseConcept(value: unknown): Concept {
  const row = asRecord(value)
  if (row.schema !== CONCEPT_SCHEMA) throw new Error("concept.json must use schema 1")
  const id = safeConceptId(requiredString(row.id, "id"))
  if (row.status !== "draft" && row.status !== "frozen") throw new Error("status must be draft or frozen")
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 1) {
    throw new Error("revision must be a positive integer")
  }
  const directions = Array.isArray(row.directions) ? row.directions.map(parseDirection) : []
  const chosen = row.chosen_direction == null ? null : requiredString(row.chosen_direction, "chosen_direction")
  if (chosen && !directions.some((item) => item.id === chosen)) throw new Error(`chosen_direction not found: ${chosen}`)
  return {
    schema: CONCEPT_SCHEMA,
    id,
    status: row.status,
    revision: row.revision,
    intent: row.intent == null ? null : parseIntent(row.intent),
    context: row.context == null ? null : parseContext(row.context),
    constraints: row.constraints == null ? null : parseConstraints(row.constraints),
    requirements: row.requirements == null ? null : parseRequirements(row.requirements),
    directions,
    chosen_direction: chosen,
    moodboards: Array.isArray(row.moodboards) ? row.moodboards.map(parseMoodboard) : [],
    frozen_at: optionalString(row.frozen_at, "frozen_at"),
    source_hash: optionalString(row.source_hash, "source_hash"),
  }
}

export function parseIntent(value: unknown): ConceptIntent {
  const row = asRecord(value)
  assertKnownKeys(row, ["one_liner", "product_type"], "intent")
  return {
    one_liner: requiredString(row.one_liner, "intent.one_liner"),
    product_type: requiredString(row.product_type, "intent.product_type"),
  }
}

export function parseContext(value: unknown): ConceptContext {
  const row = asRecord(value)
  assertKnownKeys(row, ["user", "environment", "scenarios"], "context")
  return {
    user: requiredString(row.user, "context.user"),
    environment: requiredString(row.environment, "context.environment"),
    scenarios: stringList(row.scenarios, "context.scenarios"),
  }
}

export function parseConstraints(value: unknown): ConceptConstraints {
  const row = asRecord(value)
  assertKnownKeys(row, ["envelope_mm", "cost", "process", "brand", "other"], "constraints")
  return {
    envelope_mm: parseEnvelope(row.envelope_mm),
    cost: optionalString(row.cost, "constraints.cost"),
    process: optionalString(row.process, "constraints.process"),
    brand: optionalString(row.brand, "constraints.brand"),
    other: stringList(row.other, "constraints.other"),
  }
}

export function applyUpdate(concept: Concept, section: UpdateSection, data: unknown): Concept {
  if (concept.status === "frozen") throw new Error("Concept is frozen; fork with concept_create({ from })")
  if (section === "intent") return { ...concept, intent: parseIntent(data) }
  if (section === "context") return { ...concept, context: parseContext(data) }
  if (section === "constraints") return { ...concept, constraints: parseConstraints(data) }
  if (section === "requirements") return { ...concept, requirements: parseRequirements(data) }
  const row = asRecord(data)
  const direction = parseDirection(data)
  const directions = [...concept.directions.filter((item) => item.id !== direction.id), direction]
  const chosen = row.chosen === true ? direction.id : concept.chosen_direction
  if (chosen && !directions.some((item) => item.id === chosen)) throw new Error(`chosen_direction not found: ${chosen}`)
  return { ...concept, directions, chosen_direction: chosen }
}

export function isUpdateSection(value: string): value is UpdateSection {
  return (UPDATE_SECTIONS as readonly string[]).includes(value)
}

const REVIEW_SEVERITIES = new Set<ReviewSeverity>(["blocker", "weak", "note"])

export function parseReview(value: unknown): Review {
  const row = asRecord(value)
  if (row.schema !== 1) throw new Error("review.json must use schema 1")
  if (!Array.isArray(row.findings)) throw new Error("review.json findings must be an array")
  return {
    schema: 1,
    concept_id: requiredString(row.concept_id, "concept_id"),
    concept_hash: requiredString(row.concept_hash, "concept_hash"),
    findings: row.findings.map((item, index) => {
      const finding = asRecord(item)
      const severity = finding.severity
      if (typeof severity !== "string" || !REVIEW_SEVERITIES.has(severity as ReviewSeverity)) {
        throw new Error(`findings[${index}].severity must be blocker, weak, or note`)
      }
      return {
        id: requiredString(finding.id, `findings[${index}].id`),
        severity: severity as ReviewSeverity,
        topic: requiredString(finding.topic, `findings[${index}].topic`),
        text: requiredString(finding.text, `findings[${index}].text`),
      }
    }),
  }
}

export function parseWaives(value: unknown): FreezeWaive[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error("waive must be an array")
  return value.map((item, index) => {
    const row = asRecord(item)
    return {
      id: requiredString(row.id, `waive[${index}].id`),
      reason: requiredString(row.reason, `waive[${index}].reason`),
    }
  })
}
