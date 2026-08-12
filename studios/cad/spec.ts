import type { SpecRoots } from "../../src/core/spec"
import { hashSourceFiles, type StudioSpec, writeSpec } from "../../src/core/spec"
import { resolveSpecProject } from "../../src/core/spec-resolve"
import { findDesign, initializeStudio } from "./host/library"
import { readArtifactManifest } from "./host/manifest"

export async function publishCadSpec(roots: SpecRoots, id: string, summary?: string): Promise<StudioSpec> {
  const project = await resolveSpecProject(roots, "cad", id)
  const layout = await initializeStudio(roots.cad)
  const entry = await findDesign(layout, id)
  if (!entry) throw new Error(`CAD design not found: ${id}`)
  const sourceHash = await hashSourceFiles(project.sourceFiles)
  const artifact = await readArtifactManifest(entry.directory, id).catch(() => null)
  const sizes = artifact?.parts.map((part) => ({ id: part.id, size_mm: part.metrics.size_mm })) ?? []
  const status = entry.buildStatus === "built" ? "published" : "blocked"
  const spec: StudioSpec = {
    schema: 1,
    studio: "cad",
    id: project.id,
    name: project.name,
    status,
    sourceHash,
    updatedAt: new Date().toISOString(),
    summary: summary?.trim() || `${project.name}: ${entry.partCount} parts, ${entry.buildStatus}`,
    facts: {
      partCount: entry.partCount,
      buildStatus: entry.buildStatus,
      revision: entry.revision,
      sizes,
    },
  }
  return writeSpec(project.directory, spec)
}
