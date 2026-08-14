import type { Concept } from "./schema"

export function compileBrief(concept: Concept) {
  const intent = concept.intent
  const context = concept.context
  const constraints = concept.constraints
  const requirements = concept.requirements
  const chosen = concept.directions.find((item) => item.id === concept.chosen_direction)
  const lines = [
    `# ${intent?.product_type ?? concept.id}`,
    "",
    intent?.one_liner ?? "",
    "",
    "## Context",
    "",
    `- User: ${context?.user ?? "—"}`,
    `- Environment: ${context?.environment ?? "—"}`,
    ...(context?.scenarios ?? []).map((item) => `- Scenario: ${item}`),
    "",
    "## Constraints",
    "",
    `- Envelope: ${constraints?.envelope_mm ? `${constraints.envelope_mm.join(" × ")} mm` : "—"}`,
    `- Process: ${constraints?.process ?? "—"}`,
    `- Cost: ${constraints?.cost ?? "—"}`,
    `- Brand: ${constraints?.brand ?? "—"}`,
    ...(constraints?.other ?? []).map((item) => `- ${item}`),
    "",
    "## Must",
    "",
    ...(requirements?.must ?? []).map((item) => `- ${item.id}: ${item.text}`),
    "",
    "## Should",
    "",
    ...(requirements?.should ?? []).map((item) => `- ${item.id}: ${item.text}`),
    "",
    "## Could",
    "",
    ...(requirements?.could ?? []).map((item) => `- ${item.id}: ${item.text}`),
    "",
    "## Out of scope",
    "",
    ...(requirements?.out ?? []).map((item) => `- ${item}`),
    "",
    "## Direction",
    "",
    chosen ? [`**${chosen.name}**`, "", chosen.form, "", `CMF: ${chosen.cmf}`, "", chosen.rationale] : ["—"],
    "",
    "## Moodboards",
    "",
    ...concept.moodboards.filter((item) => item.direction_id === concept.chosen_direction).map((item) => `- ${item.path}`),
    "",
  ]
  return `${lines.flat().join("\n").trim()}\n`
}
