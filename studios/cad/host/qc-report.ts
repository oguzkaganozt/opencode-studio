import type { DesignEntry } from "./library"
import { listRenders, mapArtifactPartFiles } from "./library"
import type { ArtifactManifest } from "./manifest"
import {
  latestQcEvidence,
  listQcEvidence,
  subjectsCoverParts,
  type QcEvidenceAxis,
  type QcEvidenceRecord,
} from "./qc-evidence"

export type QcAxisStatus = "pass" | "fail" | "unverified"

export type QcAxisInput = {
  status: QcAxisStatus
  findings?: string[]
}

export type QcAxisReport = {
  status: QcAxisStatus
  findings: string[]
  source: "computed" | "agent" | "evidence" | "rejected"
  evidence?: {
    tool: string
    summary: string
    recordedAt: number
    subjects?: string[]
  }
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

function isNotApplicableFinding(findings: string[]): boolean {
  return findings.some((f) => f.trim().toLowerCase() === "not applicable")
}

/** Freeform form: agent must supply substantive notes (no session form tool yet). */
function formFreeformNotesOk(findings: string[]): boolean {
  const substantive = findings.map((f) => f.trim()).filter((f) => f.length >= 12 && f.toLowerCase() !== "not applicable")
  return substantive.length >= 2 || substantive.join(" ").length >= 40
}

function evidenceMeta(evidence: QcEvidenceRecord): NonNullable<QcAxisReport["evidence"]> {
  return {
    tool: evidence.tool,
    summary: evidence.summary,
    recordedAt: evidence.recordedAt,
    subjects: evidence.subjects,
  }
}

function bindPrintability(input: {
  claimed?: QcAxisInput
  designKey: string
  revision: string | null
  partIds: string[]
}): QcAxisReport {
  const findings = input.claimed?.findings?.map((f) => f.trim()).filter(Boolean) ?? []
  const claim = input.claimed?.status
  const rows = listQcEvidence(input.designKey, "printability").filter((row) => {
    if (input.revision != null && row.revision != null && row.revision !== input.revision) return false
    return true
  })
  const passRows = rows.filter((r) => r.ok && r.status === "pass")
  const failRow = [...rows].reverse().find((r) => r.status === "fail")

  if (claim === "pass") {
    if (passRows.length === 0) {
      return {
        status: "unverified",
        findings: [
          ...findings,
          "pass rejected: no cad_analyze_printability pass evidence for this design (run after build, per part bed pose)",
        ],
        source: "rejected",
      }
    }
    const allSubjects = passRows.flatMap((r) => r.subjects ?? [])
    // Multi-part: every artifact part must appear in evidence subjects (current_shape alone insufficient).
    if (input.partIds.length > 1) {
      const coverage = subjectsCoverParts(
        allSubjects.filter((s) => s !== "current_shape"),
        input.partIds,
      )
      if (!coverage.ok) {
        return {
          status: "unverified",
          findings: [
            ...findings,
            `pass rejected: printability evidence missing parts: ${coverage.missing.join(", ")}`,
          ],
          source: "rejected",
          evidence: evidenceMeta(passRows[passRows.length - 1]!),
        }
      }
    } else if (input.partIds.length === 1) {
      const onlyCurrent = allSubjects.length > 0 && allSubjects.every((s) => s === "current_shape")
      const coverage = subjectsCoverParts(
        allSubjects.filter((s) => s !== "current_shape"),
        input.partIds,
      )
      // Single part: named subject match OR current_shape (common bed-pose flow).
      if (!coverage.ok && !onlyCurrent && allSubjects.length > 0) {
        return {
          status: "unverified",
          findings: [
            ...findings,
            `pass rejected: printability evidence subjects do not cover part ${input.partIds[0]}`,
          ],
          source: "rejected",
          evidence: evidenceMeta(passRows[passRows.length - 1]!),
        }
      }
    }
    return {
      status: "pass",
      findings,
      source: "evidence",
      evidence: evidenceMeta(passRows[passRows.length - 1]!),
    }
  }

  if (claim === "fail" || failRow) {
    const row = failRow
    return {
      status: "fail",
      findings: findings.length ? findings : row ? [row.summary] : ["reported fail"],
      source: row ? "evidence" : "agent",
      evidence: row ? evidenceMeta(row) : undefined,
    }
  }

  const latest = latestQcEvidence(input.designKey, "printability", { revision: input.revision })
  return {
    status: "unverified",
    findings: findings.length
      ? findings
      : latest
        ? [`evidence available via ${latest.tool} but axis not claimed; pass requires explicit status=pass`]
        : ["not reported"],
    source: latest ? "evidence" : "agent",
    evidence: latest ? evidenceMeta(latest) : undefined,
  }
}

function bindFit(input: {
  claimed?: QcAxisInput
  designKey: string
  revision: string | null
  partCount: number
}): QcAxisReport {
  const findings = input.claimed?.findings?.map((f) => f.trim()).filter(Boolean) ?? []
  const claim = input.claimed?.status

  // Single-part designs: fit N/A without compare.
  if (input.partCount <= 1 && claim === "pass" && isNotApplicableFinding(findings)) {
    return { status: "pass", findings: ["not applicable"], source: "agent" }
  }

  const latest = latestQcEvidence(input.designKey, "fit", { revision: input.revision })

  if (claim === "pass") {
    if (!latest) {
      return {
        status: "unverified",
        findings: [
          ...findings,
          input.partCount <= 1
            ? "pass rejected: single-part fit requires finding 'not applicable', or multi-part needs cad_compare kind=fit"
            : "pass rejected: no cad_compare kind=fit pass evidence for this design",
        ],
        source: "rejected",
      }
    }
    if (!latest.ok || latest.status !== "pass") {
      return {
        status: latest.status === "fail" ? "fail" : "unverified",
        findings: [...findings, `pass rejected: latest fit evidence is ${latest.status}: ${latest.summary}`],
        source: "rejected",
        evidence: evidenceMeta(latest),
      }
    }
    return { status: "pass", findings, source: "evidence", evidence: evidenceMeta(latest) }
  }

  if (claim === "fail" || (latest && latest.status === "fail")) {
    return {
      status: "fail",
      findings: findings.length ? findings : latest ? [latest.summary] : ["reported fail"],
      source: latest ? "evidence" : "agent",
      evidence: latest ? evidenceMeta(latest) : undefined,
    }
  }

  return {
    status: "unverified",
    findings: findings.length ? findings : latest ? [`evidence available via ${latest.tool} but axis not claimed`] : ["not reported"],
    source: latest ? "evidence" : "agent",
    evidence: latest ? evidenceMeta(latest) : undefined,
  }
}

function bindForm(input: { claimed?: QcAxisInput }): QcAxisReport {
  const findings = input.claimed?.findings?.map((f) => f.trim()).filter(Boolean) ?? []
  const claim = input.claimed?.status

  if (claim === "pass") {
    if (isNotApplicableFinding(findings)) {
      return { status: "pass", findings: ["not applicable"], source: "agent" }
    }
    if (formFreeformNotesOk(findings)) {
      return {
        status: "pass",
        findings,
        source: "agent",
      }
    }
    return {
      status: "unverified",
      findings: [
        ...findings,
        "pass rejected: form requires finding 'not applicable' (prismatic) or substantive freeform notes (≥2 findings or ≥40 chars)",
      ],
      source: "rejected",
    }
  }

  if (claim === "fail") {
    return { status: "fail", findings: findings.length ? findings : ["reported fail"], source: "agent" }
  }

  return {
    status: "unverified",
    findings: findings.length ? findings : ["not reported"],
    source: "agent",
  }
}

export async function buildDesignQcReport(input: {
  id: string
  entry: DesignEntry
  artifact: ArtifactManifest | null
  /** design-scoped key: sessionKey::designId */
  evidenceKey: string
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
    artifactFindings.push("no built artifacts; run cad_design_build")
  } else if (entry.buildStatus === "stale") {
    artifactStatus = "fail"
    artifactFindings.push("build is stale relative to sources")
  } else if (missingFiles.length > 0) {
    artifactStatus = "fail"
    artifactFindings.push(`missing artifact files: ${missingFiles.join(", ")}`)
  } else {
    artifactStatus = "pass"
  }

  const revision = entry.revision
  const partIds = parts.map((p) => p.id)
  const printability = bindPrintability({
    claimed: input.printability,
    designKey: input.evidenceKey,
    revision,
    partIds,
  })
  const fit = bindFit({
    claimed: input.fit,
    designKey: input.evidenceKey,
    revision,
    partCount: partIds.length || (artifact?.parts.length ?? 0),
  })
  const form = bindForm({ claimed: input.form })
  const renders = await listRenders(entry.directory)

  const blockedBy: string[] = []
  if (artifactStatus !== "pass") blockedBy.push("artifact")
  if (printability.status !== "pass") blockedBy.push("printability")
  if (fit.status !== "pass") blockedBy.push("fit")
  if (form.status !== "pass") blockedBy.push("form")

  const complete = blockedBy.length === 0
  const summary = complete
    ? "All QC axes pass with design-scoped evidence rules. Still does not prove material, strain, or production fitness."
    : `Incomplete: blocked by ${blockedBy.join(", ")}. Pass requires design-scoped session evidence (printability/fit) or documented form notes.`

  return {
    id,
    revision,
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
