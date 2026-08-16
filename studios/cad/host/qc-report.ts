import { readFile } from "node:fs/promises"
import type { AcceptanceV1 } from "./acceptance"
import { readAcceptance } from "./acceptance"
import type { EvidenceV1 } from "./evidence"
import { currentEvidence, latestByKey } from "./evidence"
import type { DesignEntry } from "./library"
import { listRenders, mapArtifactPartFiles } from "./library"
import type { ArtifactManifest } from "./manifest"
import { readPrintPlan } from "./print-plan"

export type QcAxisStatus = "pass" | "fail" | "unverified"

export type QcAxisReport = {
  status: QcAxisStatus
  findings: string[]
  source: "computed" | "evidence" | "rejected"
  evidence?: {
    tool: string
    summary: string
    recordedAt: number
    subjects?: string[]
  }
}

export type DesignQcReport = {
  id: string
  schema: 2 | null
  revision: string | null
  contractHash: string | null
  buildStatus: DesignEntry["buildStatus"]
  artifact: QcAxisReport & {
    partCount: number
    missingFiles: string[]
    parts: Array<{
      id: string
      bodyHash: string | null
      volume_mm3: number | null
      size_mm: { x: number; y: number; z: number } | null
      files: Record<string, { path: string; exists: boolean }>
    }>
  }
  requirements: QcAxisReport
  manufacturing: QcAxisReport
  interfaces: QcAxisReport
  findings: QcAxisReport
  renders: string[]
  complete: boolean
  blockedBy: string[]
  summary: string
}

function evidenceMeta(evidence: EvidenceV1): NonNullable<QcAxisReport["evidence"]> {
  return {
    tool: "cad_verify",
    summary: `${evidence.status} on ${evidence.axis}${evidence.requirementId ? ` ${evidence.requirementId}` : ""}${
      evidence.interfaceId ? ` ${evidence.interfaceId}` : ""
    }`,
    recordedAt: evidence.recordedAt,
    subjects: evidence.subjects,
  }
}

async function sha256File(filePath: string): Promise<string> {
  const { createHash } = await import("node:crypto")
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
}

export async function buildDesignQcReport(input: {
  id: string
  entry: DesignEntry
  artifact: ArtifactManifest | null
  designDir: string
}): Promise<DesignQcReport> {
  const { id, entry, artifact, designDir } = input
  const missingFiles: string[] = []
  const parts: DesignQcReport["artifact"]["parts"] = []
  const mismatchHashes: string[] = []

  if (artifact) {
    const partResults = await Promise.all(
      artifact.parts.map(async (part) => {
        const files = await mapArtifactPartFiles(designDir, part.files)
        for (const [format, info] of Object.entries(files)) {
          if (!info.exists) missingFiles.push(`${part.id}/${format}`)
        }
        let bodyHash = part.body_hash ?? null
        let hashMismatch = false
        if (bodyHash && files.step?.exists) {
          const actual = await sha256File(files.step.path)
          if (actual !== bodyHash) {
            mismatchHashes.push(`${part.id}/step`)
            hashMismatch = true
          }
        }
        if (hashMismatch) bodyHash = null
        return {
          id: part.id,
          bodyHash,
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
  } else if (mismatchHashes.length > 0) {
    artifactStatus = "fail"
    artifactFindings.push(`artifact STEP bytes do not match body_hash: ${mismatchHashes.join(", ")}`)
  } else {
    artifactStatus = "pass"
  }

  const revision = entry.revision
  let acceptance: AcceptanceV1 | null = null
  try {
    acceptance = await readAcceptance(designDir)
  } catch {
    // schema 1 design: no locked contract, QC cannot complete
  }
  const contractHash = acceptance?.contractHash ?? null

  const blockedBy: string[] = []
  const recordKey = (record: EvidenceV1) =>
    record.requirementId ?? record.interfaceId ?? (record.axis === "printability" ? record.subjects[0] : record.id)

  if (!artifact || artifactStatus !== "pass") blockedBy.push("artifact")

  let requirements: QcAxisReport
  let manufacturing: QcAxisReport
  let interfaces: QcAxisReport

  if (!acceptance) {
    requirements = {
      status: "unverified",
      findings: ["no locked acceptance.json; recreate the design as schema 2 with a contract"],
      source: "computed",
    }
    manufacturing = { status: "unverified", findings: ["no locked acceptance.json"], source: "computed" }
    interfaces = { status: "unverified", findings: ["no locked acceptance.json"], source: "computed" }
    blockedBy.push("requirements", "manufacturing", "interfaces")
  } else {
    const current = revision && contractHash ? await currentEvidence(designDir, revision, contractHash) : []
    const latest = latestByKey(current, recordKey)

    // Requirements: every bbox dimension has a current pass record.
    const requirementRecords = latest.filter((record) => record.axis === "requirement")
    const byRequirement = new Map(requirementRecords.map((record) => [record.requirementId, record]))
    const missingRequirements: string[] = []
    const failedRequirements: string[] = []
    for (const dim of acceptance.dimensions) {
      const record = byRequirement.get(dim.id)
      if (!record) missingRequirements.push(dim.id)
      else if (record.status !== "pass") failedRequirements.push(dim.id)
    }
    const reqFindings = [
      ...missingRequirements.map((dim) => `no current requirement pass for ${dim}; run cad_verify kind=requirements`),
      ...failedRequirements.map((dim) => `requirement ${dim} failed`),
    ]
    requirements = {
      status: reqFindings.length === 0 ? "pass" : failedRequirements.length > 0 ? "fail" : "unverified",
      findings: reqFindings,
      source: "evidence",
      ...(requirementRecords.length > 0 ? { evidence: evidenceMeta(requirementRecords[requirementRecords.length - 1]!) } : {}),
    }
    if (requirements.status !== "pass") blockedBy.push("requirements")

    // Manufacturing: every final artifact has a current print-plan entry + printability pass.
    const plan = await readPrintPlan(designDir)
    const planCurrent = plan !== null && plan.buildRevision === revision
    const artifactIds = new Set(artifact?.parts.map((part) => part.id) ?? [])
    const plannedIds = new Set(plan?.entries.map((entry) => entry.artifactId) ?? [])
    const missingPlan: string[] = []
    for (const artifactId of artifactIds) {
      if (!plannedIds.has(artifactId)) missingPlan.push(artifactId)
    }
    const printRecords = latest.filter((record) => record.axis === "printability")
    const byArtifact = new Map(printRecords.map((record) => [record.subjects[0], record]))
    const missingPrint: string[] = []
    const failedPrint: string[] = []
    for (const artifactId of artifactIds) {
      const record = byArtifact.get(artifactId)
      if (!record) missingPrint.push(artifactId)
      else if (record.status !== "pass") failedPrint.push(artifactId)
    }
    const manFindings = [
      ...(!planCurrent ? ["print plan is missing or stale; run cad_print_plan_apply"] : []),
      ...missingPlan.map((artifactId) => `print plan missing entry for ${artifactId}`),
      ...missingPrint.map((artifactId) => `no current printability pass for ${artifactId}; run cad_verify kind=printability`),
      ...failedPrint.map((artifactId) => `printability failed for ${artifactId}`),
    ]
    manufacturing = {
      status: manFindings.length === 0 ? "pass" : failedPrint.length > 0 ? "fail" : "unverified",
      findings: manFindings,
      source: "evidence",
      ...(printRecords.length > 0 ? { evidence: evidenceMeta(printRecords[printRecords.length - 1]!) } : {}),
    }
    if (manufacturing.status !== "pass") blockedBy.push("manufacturing")

    // Interfaces: every declared pair has a current matching fit pass. Omitted for single-part designs.
    if (acceptance.interfaces.length === 0) {
      interfaces = { status: "pass", findings: ["not applicable — no declared interfaces"], source: "computed" }
    } else {
      const fitRecords = latest.filter((record) => record.axis === "interface")
      const byInterface = new Map(fitRecords.map((record) => [record.interfaceId, record]))
      const missingInterfaces: string[] = []
      const failedInterfaces: string[] = []
      for (const iface of acceptance.interfaces) {
        const record = byInterface.get(iface.id)
        if (!record) missingInterfaces.push(iface.id)
        else if (record.status !== "pass") failedInterfaces.push(iface.id)
      }
      const fitFindings = [
        ...missingInterfaces.map((iface) => `no current fit pass for ${iface}; run cad_verify kind=interfaces`),
        ...failedInterfaces.map((iface) => `interface ${iface} failed`),
      ]
      interfaces = {
        status: fitFindings.length === 0 ? "pass" : failedInterfaces.length > 0 ? "fail" : "unverified",
        findings: fitFindings,
        source: "evidence",
        ...(fitRecords.length > 0 ? { evidence: evidenceMeta(fitRecords[fitRecords.length - 1]!) } : {}),
      }
      if (interfaces.status !== "pass") blockedBy.push("interfaces")
    }
  }

  // Findings: no warning or error on any current record.
  const findings: QcAxisReport = { status: "pass", findings: [], source: "computed" }
  if (acceptance && revision && contractHash) {
    const current = await currentEvidence(designDir, revision, contractHash)
    const issues = current.flatMap((record) => record.findings.map((finding) => `${record.id}: ${finding.message}`))
    if (issues.length > 0) {
      findings.status = "fail"
      findings.findings = [`unresolved findings block completion`, ...issues]
      blockedBy.push("findings")
    }
  } else if (!acceptance) {
    findings.status = "fail"
    findings.findings = ["no locked acceptance.json"]
    blockedBy.push("findings")
  }

  const renders = await listRenders(designDir)
  const complete = blockedBy.length === 0
  const summary = complete
    ? "All QC axes pass on current disk evidence. Evidence binds to the build revision and contract hash; stale records are ignored. Still does not prove material, strain, or production fitness."
    : `Incomplete: blocked by ${blockedBy.join(", ")}. Pass requires current disk evidence from cad_verify (requirements/printability/interfaces) and a current print plan.`

  return {
    id,
    schema: acceptance ? 2 : null,
    revision,
    contractHash,
    buildStatus: entry.buildStatus,
    artifact: {
      status: artifactStatus,
      findings: artifactFindings,
      source: "computed",
      partCount: parts.length,
      missingFiles,
      parts,
    },
    requirements,
    manufacturing,
    interfaces,
    findings,
    renders,
    complete,
    blockedBy,
    summary,
  }
}
