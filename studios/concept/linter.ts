import type { Concept, FreezeWaive, Review } from "./schema"

export type LintIssue = { code: string; message: string }

export function lintConcept(concept: Concept): LintIssue[] {
  const issues: LintIssue[] = []
  if (!concept.intent?.one_liner || !concept.intent.product_type) {
    issues.push({ code: "intent", message: "intent.one_liner and product_type are required" })
  }
  if (!concept.context?.user || !concept.context.environment) {
    issues.push({ code: "context", message: "context.user and environment are required" })
  }
  const constraints = concept.constraints
  if (!constraints || (!constraints.envelope_mm && !constraints.process && !constraints.cost)) {
    issues.push({ code: "constraints", message: "at least one of envelope_mm, process, or cost is required" })
  }
  const must = concept.requirements?.must ?? []
  if (must.length < 3) issues.push({ code: "must", message: "requirements.must needs at least 3 testable items" })
  if (!concept.chosen_direction || !concept.directions.some((item) => item.id === concept.chosen_direction)) {
    issues.push({ code: "direction", message: "chosen_direction must name an existing direction" })
  } else if (!concept.moodboards.some((item) => item.direction_id === concept.chosen_direction)) {
    issues.push({ code: "moodboard", message: "chosen direction needs at least one moodboard" })
  }
  return issues
}

export function lintFreeze(input: { concept: Concept; hash: string; review: Review | null; waive: FreezeWaive[] }): LintIssue[] {
  const issues = lintConcept(input.concept)
  if (!input.review) {
    issues.push({ code: "review", message: "concept_review must run before freeze" })
    return issues
  }
  if (input.review.concept_id !== input.concept.id) {
    issues.push({ code: "review", message: "review.json concept_id does not match" })
  }
  if (input.review.concept_hash !== input.hash) {
    issues.push({ code: "review_stale", message: "review.json is stale; run concept_review again" })
  }
  const waived = new Set(input.waive.filter((item) => item.reason.trim()).map((item) => item.id))
  for (const finding of input.review.findings) {
    if (finding.severity !== "blocker") continue
    if (!waived.has(finding.id)) {
      issues.push({ code: "blocker", message: `blocker ${finding.id} must be fixed or waived` })
    }
  }
  return issues
}
