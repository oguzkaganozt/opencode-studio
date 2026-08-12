import { describe, expect, test } from "bun:test"
import { buildDesignQcReport } from "../host/qc-report"
import type { DesignEntry } from "../host/library"
import {
  clearQcEvidenceForDesign,
  listQcEvidence,
  qcEvidenceKey,
  qcSessionKey,
  recordQcEvidence,
  setActiveQcDesign,
} from "../host/qc-evidence"

function entry(revision: string | null = "rev1", partCount = 1): DesignEntry {
  return {
    id: "demo",
    directory: "/tmp/demo",
    buildStatus: "built",
    partCount,
    revision,
    renderRevision: null,
  }
}

function artifact(partIds: string[]) {
  return {
    schema: 1 as const,
    id: "demo",
    parts: partIds.map((id) => ({
      id,
      files: { step: `step/${id}.step`, stl: `stl/${id}.stl`, glb: `glb/${id}.glb` },
      metrics: {
        volume_mm3: 1,
        size_mm: { x: 1, y: 1, z: 1 },
        bounds_mm: { min: [0, 0, 0], max: [1, 1, 1] },
        solid_count: 1,
      },
    })),
    build: { engine: "forge-cad/1", inputs: { "design.json": "abc" } },
  }
}

describe("QC evidence binding", () => {
  test("rejects bare pass without ledger evidence", async () => {
    const session = qcSessionKey("/engine", "/cwd-a")
    const key = qcEvidenceKey("/engine", "/cwd-a", "demo")
    clearQcEvidenceForDesign(session, "demo")
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      printability: { status: "pass" },
      fit: { status: "pass", findings: ["not applicable"] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.printability.status).toBe("unverified")
    expect(report.printability.source).toBe("rejected")
    expect(report.fit.status).toBe("pass")
    expect(report.form.status).toBe("pass")
    expect(report.complete).toBe(false)
  })

  test("accepts printability/fit when design-scoped evidence exists", async () => {
    const session = qcSessionKey("/engine", "/cwd-b")
    setActiveQcDesign(session, "demo")
    clearQcEvidenceForDesign(session, "demo")
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: true,
      status: "pass",
      summary: "0 findings",
      subjects: ["body"],
    })
    recordQcEvidence(session, {
      axis: "fit",
      tool: "cad_compare",
      ok: true,
      status: "pass",
      summary: "fit apart",
      subjects: ["body", "lid"],
    })
    const key = qcEvidenceKey("/engine", "/cwd-b", "demo")
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      printability: { status: "pass", findings: [] },
      fit: { status: "pass", findings: [] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.printability.status).toBe("pass")
    expect(report.printability.source).toBe("evidence")
    expect(report.fit.status).toBe("pass")
    expect(report.form.status).toBe("pass")
  })

  test("isolates evidence across designs", async () => {
    const session = qcSessionKey("/engine", "/cwd-c")
    clearQcEvidenceForDesign(session, "a")
    clearQcEvidenceForDesign(session, "b")
    setActiveQcDesign(session, "a")
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: true,
      status: "pass",
      summary: "a ok",
      subjects: ["body"],
    })
    const reportB = await buildDesignQcReport({
      id: "b",
      entry: { ...entry(), id: "b", buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-c", "b"),
      printability: { status: "pass" },
      fit: { status: "pass", findings: ["not applicable"] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(reportB.printability.status).toBe("unverified")
    expect(reportB.printability.source).toBe("rejected")
  })

  test("multi-part printability requires per-part subjects", async () => {
    const session = qcSessionKey("/engine", "/cwd-d")
    setActiveQcDesign(session, "demo")
    clearQcEvidenceForDesign(session, "demo")
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: true,
      status: "pass",
      summary: "body only",
      subjects: ["body"],
    })
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt", partCount: 2 },
      artifact: artifact(["body", "lid"]) as any,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-d", "demo"),
      printability: { status: "pass" },
      fit: { status: "pass", findings: [] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    // artifact files missing on disk → artifact fail; printability should still reject coverage
    expect(report.printability.status).toBe("unverified")
    expect(report.printability.findings.join(" ")).toMatch(/missing parts: lid/)
  })

  test("form freeform notes and strict not-applicable token", async () => {
    const key = qcEvidenceKey("/engine", "/cwd-e", "demo")
    const loose = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      form: { status: "pass", findings: ["overhang rule not applicable here"] },
    })
    expect(loose.form.status).toBe("unverified")

    const freeform = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      form: {
        status: "pass",
        findings: [
          "form contract: 5 stations along Z with varying section",
          "front/side/iso views match reference silhouettes",
        ],
      },
    })
    expect(freeform.form.status).toBe("pass")
  })

  test("clear on one design does not wipe another", () => {
    const session = qcSessionKey("/engine", "/cwd-f")
    setActiveQcDesign(session, "keep")
    recordQcEvidence(session, {
      axis: "fit",
      tool: "cad_compare",
      ok: true,
      status: "pass",
      summary: "keep",
      subjects: ["a", "b"],
    })
    setActiveQcDesign(session, "drop")
    recordQcEvidence(session, {
      axis: "fit",
      tool: "cad_compare",
      ok: true,
      status: "pass",
      summary: "drop",
      subjects: ["a", "b"],
    })
    clearQcEvidenceForDesign(session, "drop")
    expect(listHas(session, "keep")).toBe(true)
    expect(listHas(session, "drop")).toBe(false)
  })
})

function listHas(session: string, designId: string) {
  return listQcEvidence(`${session}::${designId}`, "fit").length > 0
}
