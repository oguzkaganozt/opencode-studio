import type { DesignEntry } from "./library"
import { listRenders, mapArtifactPartFiles } from "./library"
import type { ArtifactManifest } from "./manifest"

export type QcAxisStatus = "pass" | "fail" | "unverified"

export type QcAxisInput = {
  status: QcAxisStatus
  findings?: string[]
}

export type QcAxisReport = {
  status: QcAxisStatus
  findings: string[]
  source: "computed" | "agent"
}

export type DesignQcReport = {
  id: string
  revision: string | null
  buildStatus: DesignEntry["buildStatus"]
  artifact: QcAxisReport & {
    partCount: number
    missingFiles: string[]
    parts: Array<{
      id: string
      volume_mm3: number | null
      size_mm: { x: number; y: number; z: number } | null
      files: Record<string, { path: string; exists: boolean }>
    }>
  }
  printability: QcAxisReport
  fit: QcAxisReport
  form: QcAxisReport
  renders: string[]
  complete: boolean
  blockedBy: string[]
  summary: string
}

function normalizeAxis(input: QcAxisInput | undefined, fallback: QcAxisStatus = "unverified"): QcAxisReport {
  if (!input) {
    return { status: fallback, findings: fallback === "unverified" ? ["not reported"] : [], source: "agent" }
  }
  return {
    status: input.status,
    findings: input.findings?.map((f) => f.trim()).filter(Boolean) ?? [],
    source: "agent",
  }
}

export async function buildDesignQcReport(input: {
  id: string
  entry: DesignEntry
  artifact: ArtifactManifest | null
  printability?: QcAxisInput
  fit?: QcAxisInput
  form?: QcAxisInput
}): Promise<DesignQcReport> {
  const { id, entry, artifact } = input
  const missingFiles: string[] = []
  const parts: DesignQcReport["artifact"]["parts"] = []

  if (artifact) {
    const partResults = await Promise.all(
      artifact.parts.map(async (part) => {
        const files = await mapArtifactPartFiles(entry.directory, part.files)
        for (const [format, info] of Object.entries(files)) {
          if (!info.exists) missingFiles.push(`${part.id}/${format}`)
        }
        return {
          id: part.id,
          volume_mm3: part.metrics?.volume_mm3 ?? null,
          size_mm: part.metrics?.size_mm ?? null,
          files,
        }
      }),
    )
    parts.push(...partResults)
  }

  let artifactStatus: QcAxisStatus = "fail"
  const artifactFindings: string[] = []
  if (!artifact || entry.buildStatus === "unbuilt") {
    artifactStatus = "fail"
    artifactFindings.push("no built artifacts; run design_build")
  } else if (entry.buildStatus === "stale") {
    artifactStatus = "fail"
    artifactFindings.push("build is stale relative to sources")
  } else if (missingFiles.length > 0) {
    artifactStatus = "fail"
    artifactFindings.push(`missing artifact files: ${missingFiles.join(", ")}`)
  } else {
    artifactStatus = "pass"
  }

  const printability = normalizeAxis(input.printability)
  const fit = normalizeAxis(input.fit)
  const form = normalizeAxis(input.form)
  const renders = await listRenders(entry.directory)

  // Every axis must be explicit pass. Form "not applicable" is reported as pass with a finding.
  const blockedBy: string[] = []
  if (artifactStatus !== "pass") blockedBy.push("artifact")
  if (printability.status !== "pass") blockedBy.push("printability")
  if (fit.status !== "pass") blockedBy.push("fit")
  if (form.status !== "pass") blockedBy.push("form")

  const complete = blockedBy.length === 0
  const summary = complete
    ? "All reported QC axes pass. Still does not prove material, strain, or production fitness."
    : `Incomplete: blocked by ${blockedBy.join(", ")}. Build success alone is not verification.`

  return {
    id,
    revision: entry.revision,
    buildStatus: entry.buildStatus,
    artifact: {
      status: artifactStatus,
      findings: artifactFindings,
      source: "computed",
      partCount: parts.length,
      missingFiles,
      parts,
    },
    printability,
    fit,
    form,
    renders,
    complete,
    blockedBy,
    summary,
  }
}
