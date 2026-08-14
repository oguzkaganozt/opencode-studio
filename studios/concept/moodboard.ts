import { createHash } from "node:crypto"
import type { Concept, Direction } from "./schema"

export function resolveMoodboardDirection(concept: Concept, directionId?: string): Direction {
  const id = directionId ?? concept.chosen_direction
  if (!id) throw new Error("No direction selected; pass direction_id or choose a direction")
  const direction = concept.directions.find((item) => item.id === id)
  if (!direction) throw new Error(`Direction not found: ${id}`)
  return direction
}

export function compileMoodboardPrompt(concept: Concept, direction: Direction) {
  const intent = concept.intent
  if (!intent) throw new Error("intent is required before moodboard")
  const context = concept.context
  return [
    "Industrial design product photograph, studio lighting.",
    `Product: ${intent.product_type}. ${intent.one_liner}`,
    `Direction: ${direction.name}`,
    `Form language: ${direction.form}`,
    `CMF: ${direction.cmf}`,
    context ? `Context: ${context.user} in ${context.environment}` : "",
    "Single hero object, photoreal industrial design render, no text, no UI chrome.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function moodboardPromptHash(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex")
}

export function nextMoodboardName(concept: Concept, directionId: string, extension: string, existingFiles: Iterable<string> = []) {
  const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  const used = new Set([
    ...concept.moodboards.filter((item) => item.direction_id === directionId).map((item) => pathBasename(item.path)),
    ...existingFiles,
  ])
  for (let index = 1; index < 1000; index++) {
    const name = `${directionId}-${String(index).padStart(2, "0")}${ext}`
    if (!used.has(name)) return name
  }
  throw new Error("Too many moodboards for this direction")
}

function pathBasename(filePath: string) {
  const parts = filePath.replaceAll("\\", "/").split("/")
  return parts.at(-1) ?? filePath
}
