import { findDesign, initializeStudio } from "../../studios/cad/host/library"
import { resolveFwProject } from "../../studios/fw/workspace"
import { resolveProject } from "../../studios/pcb/workspace"
import { hashSourceFiles, isSpecStudioId, listSourceFiles, readSpecFile, type SpecRoots, type SpecStudioId, withFreshness } from "./spec"

export const FW_SPEC_SOURCES = ["project.json", "CMakeLists.txt", "sdkconfig.defaults", "main/main.c", "main/CMakeLists.txt"]

export type SpecProject = {
  studio: SpecStudioId
  id: string
  name: string
  directory: string
  sourceFiles: string[]
}

export async function resolveSpecProject(roots: SpecRoots, studio: string, id: string): Promise<SpecProject> {
  if (!isSpecStudioId(studio)) throw new Error(`Specs exist for cad, pcb, and fw only. Not '${studio}'.`)
  if (studio === "fw") {
    const project = await resolveFwProject(roots.fw, id)
    return {
      studio,
      id: project.id,
      name: project.manifest.name,
      directory: project.directory,
      sourceFiles: await listSourceFiles(project.directory, FW_SPEC_SOURCES),
    }
  }
  if (studio === "cad") {
    const layout = await initializeStudio(roots.cad)
    const entry = await findDesign(layout, id)
    if (!entry) throw new Error(`CAD design not found: ${id}`)
    return {
      studio,
      id: entry.id,
      name: entry.id,
      directory: entry.directory,
      sourceFiles: await listSourceFiles(entry.directory, ["design.json", "params.py", "acceptance.json", "parts/"]),
    }
  }
  const project = await resolveProject(roots.pcb, id)
  return {
    studio,
    id: project.id,
    name: project.name,
    directory: project.absolutePath,
    sourceFiles: await listSourceFiles(project.absolutePath, ["src/circuit.tsx"]),
  }
}

export async function readResolvedSpec(roots: SpecRoots, studio: string, id: string) {
  const project = await resolveSpecProject(roots, studio, id)
  const spec = await readSpecFile(project.directory)
  const currentHash = await hashSourceFiles(project.sourceFiles)
  return withFreshness(spec, currentHash)
}
