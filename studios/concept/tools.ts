import { mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { canonicalExistingDirectory } from "../../src/core/paths"
import type { GeneratedImage } from "../../src/platform/image/generate"
import { generateImage } from "../../src/platform/image/generate"
import { prepareNewOutput, writeNewFileAtomic } from "../../src/platform/image/path"
import { compileBrief } from "./brief"
import { lintFreeze } from "./linter"
import { compileMoodboardPrompt, moodboardPromptHash, nextMoodboardName, resolveMoodboardDirection } from "./moodboard"
import { conceptFail, conceptPass } from "./result"
import { applyUpdate, isUpdateSection, parseReview, parseWaives, UPDATE_SECTIONS } from "./schema"
import {
  briefPath,
  createConcept,
  hashConceptFile,
  moodboardsDir,
  readReviewIfPresent,
  resolveConcept,
  writeConcept,
  writeReview,
} from "./workspace"

export type ConceptImageGenerator = (input: { prompt: string; signal: AbortSignal }) => Promise<GeneratedImage>

export type ConceptPluginOptions = {
  workspaceRoot?: string
  generateImage?: ConceptImageGenerator
}

async function canonicalWorkspaceRoot(rawPath: string) {
  if (!path.isAbsolute(rawPath)) throw new Error(`workspaceRoot must be an absolute path: ${rawPath}`)
  try {
    return await canonicalExistingDirectory(rawPath, "workspaceRoot")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("does not exist")) throw new Error(`workspaceRoot does not exist: ${rawPath}`)
    throw new Error(message)
  }
}

export function createConceptStudioPlugin(options: ConceptPluginOptions = {}): Plugin {
  return async (context) => {
    const workspaceRoot = await canonicalWorkspaceRoot(options.workspaceRoot ?? context.directory)
    const imageGenerate =
      options.generateImage ?? ((input) => generateImage({ prompt: input.prompt, referenceImages: [], signal: input.signal }))

    return {
      tool: {
        concept_create: tool({
          description:
            "Scaffold a Concept Studio project (concept.json). Optional from copies an existing concept as a new draft revision.",
          args: {
            id: tool.schema.string().describe("Concept id: lowercase letters, digits, dashes"),
            from: tool.schema.string().optional().describe("Existing concept id to fork"),
          },
          async execute(args) {
            try {
              const created = await createConcept(workspaceRoot, args.id, args.from)
              return conceptPass(
                "concept_create",
                `Created concept ${created.id}`,
                { id: created.id, directory: created.directory, revision: created.concept.revision },
                ["concept_update intent", "concept_update context"],
              )
            } catch (error) {
              return conceptFail("concept_create", "create_failed", error instanceof Error ? error.message : String(error))
            }
          },
        }),

        concept_update: tool({
          description: "Write one concept.json section. Only writer after create. Rejects frozen concepts and vague musts.",
          args: {
            id: tool.schema.string().describe("Concept id"),
            section: tool.schema.string().describe(`One of ${UPDATE_SECTIONS.join(", ")}`),
            data: tool.schema.object({}).catchall(tool.schema.any()).describe("Section payload"),
          },
          async execute(args) {
            try {
              if (!isUpdateSection(args.section)) {
                return conceptFail("concept_update", "bad_section", `section must be one of ${UPDATE_SECTIONS.join(", ")}`)
              }
              const entry = await resolveConcept(workspaceRoot, args.id)
              const next = applyUpdate(entry.concept, args.section, args.data)
              await writeConcept(entry.directory, next)
              return conceptPass("concept_update", `Updated ${args.section} on ${entry.id}`, {
                id: entry.id,
                section: args.section,
                status: next.status,
              })
            } catch (error) {
              return conceptFail("concept_update", "update_failed", error instanceof Error ? error.message : String(error))
            }
          },
        }),

        concept_moodboard: tool({
          description:
            "Generate a moodboard from intent + direction. Prompt is compiled from concept.json; there is no freeform prompt argument.",
          args: {
            id: tool.schema.string().describe("Concept id"),
            direction_id: tool.schema.string().optional().describe("Direction id; defaults to chosen_direction"),
          },
          async execute(args, toolContext) {
            try {
              const entry = await resolveConcept(workspaceRoot, args.id)
              if (entry.concept.status === "frozen") {
                return conceptFail("concept_moodboard", "frozen", "Concept is frozen; fork with concept_create({ from })")
              }
              const direction = resolveMoodboardDirection(entry.concept, args.direction_id)
              const prompt = compileMoodboardPrompt(entry.concept, direction)
              const promptHash = moodboardPromptHash(prompt)
              const image = await imageGenerate({ prompt, signal: toolContext.abort })
              const boardDir = moodboardsDir(entry.directory)
              await mkdir(boardDir, { recursive: true })
              const existing = await readdir(boardDir).catch(() => [] as string[])
              const fileName = nextMoodboardName(entry.concept, direction.id, image.extension, existing)
              const reserved = await prepareNewOutput({
                root: workspaceRoot,
                outputPath: path.join(entry.id, "moodboards", fileName),
                ask: toolContext.ask,
              })
              await writeNewFileAtomic(reserved.outputPath, image.bytes)
              const ref = {
                path: path.posix.join("moodboards", fileName),
                direction_id: direction.id,
                prompt_hash: promptHash,
                provider: image.provider,
              }
              const next = { ...entry.concept, moodboards: [...entry.concept.moodboards, ref] }
              await writeConcept(entry.directory, next)
              return conceptPass("concept_moodboard", `Wrote ${ref.path}`, {
                id: entry.id,
                moodboard: ref,
                prompt_hash: promptHash,
              })
            } catch (error) {
              return conceptFail("concept_moodboard", "moodboard_failed", error instanceof Error ? error.message : String(error))
            }
          },
        }),

        concept_review: tool({
          description:
            "Record a studio-concept-review pass to review.json. Load that skill first, then pass findings. Does not edit concept.json.",
          args: {
            id: tool.schema.string().describe("Concept id"),
            findings: tool.schema
              .array(
                tool.schema.object({
                  id: tool.schema.string(),
                  severity: tool.schema.string().describe("blocker, weak, or note"),
                  topic: tool.schema.string(),
                  text: tool.schema.string(),
                }),
              )
              .describe("Review findings from studio-concept-review"),
          },
          async execute(args) {
            try {
              const entry = await resolveConcept(workspaceRoot, args.id)
              const conceptHash = await hashConceptFile(entry.directory)
              const review = parseReview({
                schema: 1,
                concept_id: entry.id,
                concept_hash: conceptHash,
                findings: args.findings,
              })
              await writeReview(entry.directory, review)
              return conceptPass("concept_review", `Review wrote ${review.findings.length} finding(s)`, { id: entry.id, review }, [
                "Fix blockers with concept_update or waive them on concept_freeze",
              ])
            } catch (error) {
              return conceptFail("concept_review", "review_failed", error instanceof Error ? error.message : String(error))
            }
          },
        }),

        concept_freeze: tool({
          description: "Lint and lock a concept. Writes BRIEF.md. Frozen concepts cannot be updated.",
          args: {
            id: tool.schema.string().describe("Concept id"),
            waive: tool.schema
              .array(tool.schema.object({ id: tool.schema.string(), reason: tool.schema.string() }))
              .optional()
              .describe("Accepted review blockers"),
          },
          async execute(args) {
            try {
              const entry = await resolveConcept(workspaceRoot, args.id)
              if (entry.concept.status === "frozen") {
                return conceptFail("concept_freeze", "frozen", "Concept is already frozen")
              }
              const hash = await hashConceptFile(entry.directory)
              const review = await readReviewIfPresent(entry.directory)
              const waive = parseWaives(args.waive)
              const issues = lintFreeze({ concept: entry.concept, hash, review, waive })
              if (issues.length > 0) {
                return conceptFail("concept_freeze", "lint_failed", issues.map((item) => item.message).join("; "), { issues })
              }
              const frozen = {
                ...entry.concept,
                status: "frozen" as const,
                frozen_at: new Date().toISOString(),
                source_hash: hash,
              }
              await writeConcept(entry.directory, frozen)
              await writeFile(briefPath(entry.directory), compileBrief(frozen), "utf8")
              return conceptPass("concept_freeze", `Frozen ${entry.id}`, {
                id: entry.id,
                status: frozen.status,
                source_hash: hash,
                brief: "BRIEF.md",
              })
            } catch (error) {
              return conceptFail("concept_freeze", "freeze_failed", error instanceof Error ? error.message : String(error))
            }
          },
        }),
      },
    }
  }
}
