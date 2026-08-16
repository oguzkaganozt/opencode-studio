import path from "node:path"
import { structureCadSessionResult } from "../tools/result"
import { getCadRuntimeSession } from "../tools/session"
import type { AcceptanceV1 } from "./acceptance"
import { type EvidenceV1, writeEvidenceRecord } from "./evidence"
import type { ArtifactManifest } from "./manifest"
import { buildRevision } from "./manifest"
import { readPrintPlan } from "./print-plan"

export type CadVerifyKind = "requirements" | "printability" | "interfaces"

export class VerifyError extends Error {}

type RuntimeCall = (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>

function runtimeFor(engineProjectDir: string, cwd: string, sessionID?: string, signal?: AbortSignal): RuntimeCall {
  const runtime = getCadRuntimeSession(engineProjectDir, cwd, sessionID)
  return async (name, args) => runtime.callTool(name, args, { signal, resetSessionOnFailure: false })
}

/**
 * Verify session objects are design-scoped so a previous design's verify
 * leftovers cannot shadow or leak into the current design's namespace.
 */
function verifyObjectName(designId: string, artifactId: string, suffix = ""): string {
  const stem = designId.replace(/[^a-zA-Z0-9_]/g, "_")
  return `_v_${stem}_${artifactId}${suffix}`
}

async function importArtifact(
  call: RuntimeCall,
  designDir: string,
  artifact: ArtifactManifest,
  artifactId: string,
  name: string,
): Promise<void> {
  const part = artifact.parts.find((item) => item.id === artifactId)
  if (!part) throw new VerifyError(`Artifact ${artifactId} not in manifest`)
  const stepPath = path.join(designDir, part.files.step)
  const result = await call("import_cad_file", { path: stepPath, name })
  if (result.isError) throw new VerifyError(`Failed to import ${artifactId}: ${result.text}`)
}

/** Measure the imported artifact and return its axis size in mm. */
async function measureAxisSize(call: RuntimeCall, name: string, axis: "X" | "Y" | "Z"): Promise<{ size: number; summary: string }> {
  const result = await call("measure", { object_name: name })
  const envelope = structureCadSessionResult({ entryName: "measure", toolName: "cad_measure", text: result.text, isError: result.isError })
  const data = envelope.data as Record<string, unknown> | null
  const bbox = data?.bbox as Record<string, unknown> | null
  const key = axis === "X" ? "xsize" : axis === "Y" ? "ysize" : "zsize"
  const size = bbox && typeof bbox[key] === "number" ? (bbox[key] as number) : null
  if (size === null) throw new VerifyError(`measure returned no bbox ${key} for ${name}: ${envelope.summary}`)
  return { size, summary: envelope.summary }
}

async function verifyRequirements(input: {
  designId: string
  designDir: string
  artifact: ArtifactManifest
  acceptance: AcceptanceV1
  revision: string
  call: RuntimeCall
}): Promise<EvidenceV1[]> {
  const records: EvidenceV1[] = []
  for (const dim of input.acceptance.dimensions) {
    const name = verifyObjectName(input.designId, dim.artifactId)
    await importArtifact(input.call, input.designDir, input.artifact, dim.artifactId, name)
    const { size } = await measureAxisSize(input.call, name, dim.axis)
    const within = Math.abs(size - dim.targetMm) <= dim.toleranceMm
    records.push(
      await writeEvidenceRecord(input.designDir, {
        id: `req-${dim.id}`,
        axis: "requirement",
        buildRevision: input.revision,
        contractHash: input.acceptance.contractHash,
        subjects: [dim.artifactId],
        requirementId: dim.id,
        status: within ? "pass" : "fail",
        findings: within
          ? []
          : [{ severity: "error", message: `${dim.artifactId} ${dim.axis} is ${size.toFixed(2)} mm, target ${dim.targetMm} ± ${dim.toleranceMm} mm` }],
      }),
    )
  }
  return records
}

async function verifyPrintability(input: {
  designId: string
  designDir: string
  artifact: ArtifactManifest
  acceptance: AcceptanceV1
  revision: string
  call: RuntimeCall
}): Promise<EvidenceV1[]> {
  const plan = await readPrintPlan(input.designDir)
  if (!plan || plan.buildRevision !== input.revision) {
    throw new VerifyError("print plan is missing or stale; run cad_print_plan_apply for the current build first")
  }
  const byId = new Map(plan.entries.map((entry) => [entry.artifactId, entry]))
  const manufacturing = input.acceptance.manufacturing
  const minPerimeters = Math.max(2, Math.ceil(manufacturing.minimumWallMm / manufacturing.nozzleMm))
  const buildVolume = manufacturing.buildVolumeMm.join(" ")
  const records: EvidenceV1[] = []
  for (const part of input.artifact.parts) {
    const entry = byId.get(part.id)
    if (!entry) throw new VerifyError(`Print plan missing entry for ${part.id}`)
    const name = verifyObjectName(input.designId, part.id)
    await importArtifact(input.call, input.designDir, input.artifact, part.id, name)
    const [rx, ry, rz] = entry.rotateDeg
    const [tx, ty, tz] = entry.translateMm
    const poseName = verifyObjectName(input.designId, part.id, "_pose")
    const pose = await input.call("execute", {
      code: `from build123d import *\ns = cad_object("${name}")\ns = s.move(Location((${tx}, ${ty}, ${tz}), (${rx}, ${ry}, ${rz})))\nshow(s, "${poseName}")`,
    })
    if (pose.isError) throw new VerifyError(`Failed to pose ${part.id}: ${pose.text}`)
    const result = await input.call("analyze_printability", {
      object_name: poseName,
      nozzle: manufacturing.nozzleMm,
      min_perimeters: minPerimeters,
      build_volume: buildVolume,
      bed_tol: manufacturing.bedToleranceMm,
      min_feature: manufacturing.minimumWallMm,
    })
    const envelope = structureCadSessionResult({
      entryName: "analyze_printability",
      toolName: "cad_analyze_printability",
      text: result.text,
      isError: result.isError,
    })
    // Record only the analyzer's real findings (severity + message). The
    // structured envelope's generic "reorient to bed pose" warning is guidance
    // for interactive use, not a finding — verify already poses per the plan.
    const data = envelope.data as { findings?: Array<{ severity?: string; message?: string }> } | null
    const findings: EvidenceV1["findings"] = (data?.findings ?? [])
      .filter((finding) => finding.severity === "warning" || finding.severity === "error")
      .map((finding) => ({ severity: finding.severity as "warning" | "error", message: finding.message ?? "printability finding" }))
    if (!envelope.ok) {
      findings.push({ severity: "error", message: envelope.summary })
    }
    records.push(
      await writeEvidenceRecord(input.designDir, {
        id: `print-${part.id}`,
        axis: "printability",
        buildRevision: input.revision,
        contractHash: input.acceptance.contractHash,
        subjects: [part.id],
        status: envelope.ok ? "pass" : "fail",
        findings,
      }),
    )
  }
  return records
}

/**
 * Evaluate a fit record against the contract's declared fit kind and the
 * target ± tolerance gap. The analyzer reports apart/touching/interpenetrating
 * with a clearance value; the contract kind decides which state passes.
 */
function evaluateFit(
  iface: AcceptanceV1["interfaces"][number],
  data: Record<string, unknown> | null,
  summary: string,
): { status: "pass" | "fail"; findings: EvidenceV1["findings"] } {
  const findings: EvidenceV1["findings"] = []
  if (!data) {
    return { status: "fail", findings: [{ severity: "error", message: `no fit data for ${iface.id}: ${summary}` }] }
  }
  const status = typeof data.status === "string" ? data.status : "unknown"
  const clearance = typeof data.clearance === "number" ? data.clearance : null
  const target = iface.targetMm
  const tolerance = iface.toleranceMm

  if (iface.fit === "clearance") {
    // Positive gap within target ± tolerance.
    if (status !== "apart") {
      return {
        status: "fail",
        findings: [{ severity: "error", message: `interface ${iface.id} expects clearance, analyzer reports ${status}: ${summary}` }],
      }
    }
    const gap = clearance ?? 0
    if (gap < 0 || Math.abs(gap - target) > tolerance) {
      return {
        status: "fail",
        findings: [
          { severity: "error", message: `interface ${iface.id} gap ${gap.toFixed(3)} mm outside target ${target} ± ${tolerance} mm: ${summary}` },
        ],
      }
    }
    return { status: "pass", findings }
  }

  if (iface.fit === "contact") {
    // Surfaces meet (clearance ≈ 0) within tolerance.
    if (status !== "touching" && !(status === "apart" && (clearance ?? Infinity) <= tolerance)) {
      return {
        status: "fail",
        findings: [
          { severity: "error", message: `interface ${iface.id} expects contact, analyzer reports ${status} (clearance ${clearance ?? "n/a"} mm): ${summary}` },
        ],
      }
    }
    const gap = clearance ?? 0
    if (Math.abs(gap - target) > tolerance) {
      return {
        status: "fail",
        findings: [
          { severity: "error", message: `interface ${iface.id} gap ${gap.toFixed(3)} mm outside target ${target} ± ${tolerance} mm: ${summary}` },
        ],
      }
    }
    return { status: "pass", findings }
  }

  // interference: intended overlap — analyzer reports interpenetrating.
  if (status !== "interpenetrating") {
    return {
      status: "fail",
      findings: [
        { severity: "error", message: `interface ${iface.id} expects interference, analyzer reports ${status}: ${summary}` },
      ],
    }
  }
  // Intended interference is contract-conformant, not a defect; no findings.
  return { status: "pass", findings }
}

async function verifyInterfaces(input: {
  designId: string
  designDir: string
  artifact: ArtifactManifest
  acceptance: AcceptanceV1
  revision: string
  call: RuntimeCall
}): Promise<EvidenceV1[]> {
  const records: EvidenceV1[] = []
  for (const iface of input.acceptance.interfaces) {
    const nameA = verifyObjectName(input.designId, iface.a)
    const nameB = verifyObjectName(input.designId, iface.b)
    await importArtifact(input.call, input.designDir, input.artifact, iface.a, nameA)
    await importArtifact(input.call, input.designDir, input.artifact, iface.b, nameB)
    const result = await input.call("compare", { a: nameA, b: nameB, kind: "fit" })
    const envelope = structureCadSessionResult({
      entryName: "compare",
      toolName: "cad_compare",
      text: result.text,
      isError: result.isError,
      args: { kind: "fit" },
    })
    const data = envelope.data as Record<string, unknown> | null
    const evaluated = evaluateFit(iface, data, envelope.summary)
    records.push(
      await writeEvidenceRecord(input.designDir, {
        id: `fit-${iface.id}`,
        axis: "interface",
        buildRevision: input.revision,
        contractHash: input.acceptance.contractHash,
        subjects: [iface.a, iface.b],
        interfaceId: iface.id,
        status: evaluated.status,
        findings: evaluated.findings,
      }),
    )
  }
  return records
}

export async function runCadVerify(input: {
  designDir: string
  id: string
  engineProjectDir: string
  cwd: string
  sessionID?: string
  artifact: ArtifactManifest
  acceptance: AcceptanceV1
  kind: CadVerifyKind
  signal?: AbortSignal
}): Promise<{ records: EvidenceV1[] }> {
  const revision = buildRevision(input.artifact)
  const call = runtimeFor(input.engineProjectDir, input.cwd, input.sessionID, input.signal)
  const common = {
    designId: input.id,
    designDir: input.designDir,
    artifact: input.artifact,
    acceptance: input.acceptance,
    revision,
    call,
  }
  let records: EvidenceV1[] = []
  if (input.kind === "requirements") records = await verifyRequirements(common)
  else if (input.kind === "printability") records = await verifyPrintability(common)
  else records = await verifyInterfaces(common)
  return { records }
}
