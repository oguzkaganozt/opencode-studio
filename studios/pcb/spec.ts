import type { SpecRoots } from "../../src/core/spec"
import { hashSourceFiles, type StudioSpec, writeSpec } from "../../src/core/spec"
import { resolveSpecProject } from "../../src/core/spec-resolve"
import { resolveProject } from "./workspace"

export async function publishPcbSpec(roots: SpecRoots, id: string, summary?: string): Promise<StudioSpec> {
  const project = await resolveSpecProject(roots, "pcb", id)
  const circuit = await resolveProject(roots.pcb, id)
  const sourceHash = await hashSourceFiles(project.sourceFiles)
  const status = circuit.fabricationReady ? "published" : "blocked"
  const spec: StudioSpec = {
    schema: 1,
    studio: "pcb",
    id: project.id,
    name: project.name,
    status,
    sourceHash,
    updatedAt: new Date().toISOString(),
    summary:
      summary?.trim() ||
      `${project.name}: design ${circuit.inspection?.designValid ? "valid" : "not valid"}, fab ${
        circuit.fabricationReady ? "ready" : "blocked"
      }`,
    facts: {
      designValid: circuit.inspection?.designValid ?? null,
      fabricationReady: circuit.fabricationReady,
      assemblyReady: circuit.assemblyReady,
      errorCount: circuit.inspection?.errorCount ?? null,
      warningCount: circuit.inspection?.warningCount ?? null,
      artifactStatus: circuit.artifactStatus,
    },
  }
  return writeSpec(project.directory, spec)
}
