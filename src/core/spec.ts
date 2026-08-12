import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { resolveStudioRoot as ResolveStudioRoot } from "../config"

export const SPEC_STUDIOS = ["cad", "pcb", "fw"] as const
export type SpecStudioId = (typeof SPEC_STUDIOS)[number]
export type SpecStatus = "published" | "stale" | "blocked"

export type StudioSpec = {
  schema: 1
  studio: SpecStudioId
  id: string
  name: string
  status: SpecStatus
  sourceHash: string
  updatedAt: string
  summary: string
  facts: Record<string, unknown>
}

export type SpecRoots = Record<SpecStudioId, string>

export function isSpecStudioId(value: string): value is SpecStudioId {
  return (SPEC_STUDIOS as readonly string[]).includes(value)
}

export function specFilePath(directory: string) {
  return path.join(directory, "SPEC.json")
}

export async function hashSourceFiles(files: string[]) {
  const hash = createHash("sha256")
  for (const filePath of [...files].sort()) {
    try {
      hash.update(filePath)
      hash.update(await readFile(filePath))
    } catch {
      hash.update(`${filePath}:missing`)
    }
  }
  return hash.digest("hex")
}

export async function writeSpec(directory: string, spec: StudioSpec) {
  const filePath = specFilePath(directory)
  await writeFile(filePath, `${JSON.stringify(spec, null, 2)}\n`)
  return spec
}

export async function readSpecFile(directory: string): Promise<StudioSpec> {
  const raw = JSON.parse(await readFile(specFilePath(directory), "utf8")) as Partial<StudioSpec>
  if (raw.schema !== 1 || !raw.studio || !raw.id || !raw.status || !raw.sourceHash || !raw.summary) {
    throw new Error("Invalid SPEC.json")
  }
  return raw as StudioSpec
}

export function withFreshness(spec: StudioSpec, currentHash: string): StudioSpec {
  if (spec.status === "blocked") return spec
  if (spec.sourceHash !== currentHash) return { ...spec, status: "stale" }
  return spec
}

export async function resolveSpecRoots(input: {
  studioRoot: string
  roots: Parameters<typeof ResolveStudioRoot>[0]["roots"]
  resolveStudioRoot: typeof ResolveStudioRoot
}): Promise<SpecRoots> {
  const [cad, pcb, fw] = await Promise.all([
    input.resolveStudioRoot({ studioId: "cad", studioRoot: input.studioRoot, roots: input.roots }),
    input.resolveStudioRoot({ studioId: "pcb", studioRoot: input.studioRoot, roots: input.roots }),
    input.resolveStudioRoot({ studioId: "fw", studioRoot: input.studioRoot, roots: input.roots }),
  ])
  return { cad, pcb, fw }
}

export async function listSourceFiles(directory: string, relativePaths: string[]) {
  const files: string[] = []
  for (const relative of relativePaths) {
    const full = path.join(directory, relative)
    if (relative.endsWith("/")) {
      try {
        const entries = await readdir(full)
        files.push(...entries.map((name) => path.join(full, name)))
      } catch {}
    } else {
      files.push(full)
    }
  }
  return files
}
