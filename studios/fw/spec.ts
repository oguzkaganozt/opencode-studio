import type { SpecRoots } from "../../src/core/spec"
import { hashSourceFiles, type StudioSpec, writeSpec } from "../../src/core/spec"
import { resolveSpecProject } from "../../src/core/spec-resolve"
import { buildRecordPath, type FwBuildRecord, type FwRunRecord, readJsonIfPresent, runRecordPath } from "./workspace"

export async function publishFwSpec(roots: SpecRoots, id: string, summary?: string): Promise<StudioSpec> {
  const project = await resolveSpecProject(roots, "fw", id)
  const build = await readJsonIfPresent<FwBuildRecord>(buildRecordPath(project.directory))
  const run = await readJsonIfPresent<FwRunRecord>(runRecordPath(project.directory))
  const sourceHash = await hashSourceFiles(project.sourceFiles)
  const simCurrent = Boolean(run?.ok && run.sourceHash === sourceHash)
  const status = simCurrent ? "published" : "blocked"
  const spec: StudioSpec = {
    schema: 1,
    studio: "fw",
    id: project.id,
    name: project.name,
    status,
    sourceHash,
    updatedAt: new Date().toISOString(),
    summary: summary?.trim() || `${project.name} (${run?.chip ?? "unknown chip"}): sim ${simCurrent ? "ok" : (run?.reason ?? "not run")}`,
    facts: {
      chip: run?.chip,
      engine: run?.engine,
      buildOk: build?.ok ?? null,
      simOk: simCurrent,
      simReason: run?.reason ?? null,
      expect: run?.expect ?? null,
    },
  }
  return writeSpec(project.directory, spec)
}
