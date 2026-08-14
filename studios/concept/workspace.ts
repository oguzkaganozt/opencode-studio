import { createHash } from "node:crypto"
import { cp, lstat, mkdir, opendir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"
import { type Concept, emptyConcept, parseConcept, parseReview, type Review, safeConceptId } from "./schema"

export function conceptJsonPath(directory: string) {
  return path.join(directory, "concept.json")
}

export function reviewJsonPath(directory: string) {
  return path.join(directory, "review.json")
}

export function briefPath(directory: string) {
  return path.join(directory, "BRIEF.md")
}

export function moodboardsDir(directory: string) {
  return path.join(directory, "moodboards")
}

export type ConceptEntry = {
  id: string
  directory: string
  concept: Concept
}

export async function resolveConcept(root: string, id: string): Promise<ConceptEntry> {
  const conceptId = safeConceptId(id)
  const canonicalRoot = await realpath(root)
  const candidate = path.join(canonicalRoot, conceptId)
  const info = await lstat(candidate)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Concept not found: ${conceptId}`)
  const directory = await realpath(candidate)
  if (!isInside(canonicalRoot, directory) || path.dirname(directory) !== canonicalRoot) {
    throw new Error(`Unsafe concept: ${conceptId}`)
  }
  const concept = parseConcept(JSON.parse(await readFile(conceptJsonPath(directory), "utf8")))
  if (concept.id !== conceptId) throw new Error(`concept.json id mismatch: ${concept.id}`)
  return { id: conceptId, directory, concept }
}

export async function listConcepts(root: string): Promise<ConceptEntry[]> {
  const canonicalRoot = await realpath(root)
  const entries: ConceptEntry[] = []
  const dir = await opendir(canonicalRoot)
  for await (const entry of dir) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    try {
      entries.push(await resolveConcept(canonicalRoot, entry.name))
    } catch {
      // skip incomplete folders
    }
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id, "en-US"))
}

export async function writeConcept(directory: string, concept: Concept) {
  await mkdir(directory, { recursive: true })
  await writeFile(conceptJsonPath(directory), `${JSON.stringify(concept, null, 2)}\n`, "utf8")
}

export async function hashConceptFile(directory: string) {
  const bytes = await readFile(conceptJsonPath(directory))
  return createHash("sha256").update(bytes).digest("hex")
}

export async function readReviewIfPresent(directory: string): Promise<Review | null> {
  try {
    return parseReview(JSON.parse(await readFile(reviewJsonPath(directory), "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export async function writeReview(directory: string, review: Review) {
  await writeFile(reviewJsonPath(directory), `${JSON.stringify(review, null, 2)}\n`, "utf8")
}

export async function readBriefIfPresent(directory: string) {
  try {
    return await readFile(briefPath(directory), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export async function createConcept(root: string, id: string, from?: string) {
  const conceptId = safeConceptId(id)
  const directory = path.join(root, conceptId)
  const source = from ? await resolveConcept(root, from) : null
  try {
    await lstat(directory)
    throw new Error(`Concept already exists: ${conceptId}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  try {
    await mkdir(moodboardsDir(directory), { recursive: true })
    const concept: Concept = source
      ? {
          ...source.concept,
          id: conceptId,
          status: "draft",
          revision: source.concept.revision + 1,
          frozen_at: null,
          source_hash: null,
        }
      : emptyConcept(conceptId)
    await writeConcept(directory, concept)
    if (source) {
      try {
        await cp(moodboardsDir(source.directory), moodboardsDir(directory), { recursive: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
    return { id: conceptId, directory, concept }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
