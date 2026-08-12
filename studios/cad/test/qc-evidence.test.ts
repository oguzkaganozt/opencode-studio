import { describe, expect, test } from "bun:test"
import type { DesignEntry } from "../host/library"
import {
  clearQcEvidenceForDesign,
  listQcEvidence,
  qcEvidenceKey,
  qcSessionKey,
  recordQcEvidence,
  setActiveQcDesign,
} from "../host/qc-evidence"
import { buildDesignQcReport } from "../host/qc-report"

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

  test("printability subjects match part ids with pose suffixes and hyphens", async () => {
    const { normalizeSubject, subjectsCoverParts } = await import("../host/qc-evidence")
    expect(normalizeSubject("base_print")).toBe("base")
    expect(normalizeSubject("trim-left")).toBe("trim_left")
    expect(normalizeSubject("trim_left_print")).toBe("trim_left")
    expect(normalizeSubject("diffuser_print_side")).toBe("diffuser")
    expect(normalizeSubject("body_built")).toBe("body")

    const cover = subjectsCoverParts(
      ["base_print", "diffuser_print_side", "trim_left_print", "trim_right_print", "foot_print"],
      ["base", "diffuser", "trim-left", "trim-right", "foot"],
    )
    expect(cover.ok).toBe(true)
    expect(cover.missing).toEqual([])

    const session = qcSessionKey("/engine", "/cwd-d2")
    setActiveQcDesign(session, "sconce")
    clearQcEvidenceForDesign(session, "sconce")
    for (const sub of ["base_print", "diffuser_print", "trim_left_print", "trim_right_print", "foot_print"]) {
      recordQcEvidence(session, {
        axis: "printability",
        tool: "cad_analyze_printability",
        ok: true,
        status: "pass",
        summary: `${sub} ok`,
        subjects: [sub],
      })
    }
    const report = await buildDesignQcReport({
      id: "sconce",
      entry: { ...entry("rev1", 5), id: "sconce", buildStatus: "unbuilt", partCount: 5 },
      artifact: artifact(["base", "diffuser", "trim-left", "trim-right", "foot"]) as any,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-d2", "sconce"),
      printability: { status: "pass", findings: [] },
      fit: { status: "pass", findings: ["not applicable"] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.printability.status).toBe("pass")
    expect(report.printability.source).toBe("evidence")
  })

  test("form requires analyze_form evidence or strict not-applicable", async () => {
    const session = qcSessionKey("/engine", "/cwd-e")
    const key = qcEvidenceKey("/engine", "/cwd-e", "demo")
    clearQcEvidenceForDesign(session, "demo")

    const loose = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      form: { status: "pass", findings: ["overhang rule not applicable here"] },
    })
    expect(loose.form.status).toBe("unverified")

    const notesOnly = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      form: {
        status: "pass",
        findings: ["form contract: 5 stations along Z with varying section", "front/side/iso views match reference silhouettes"],
      },
    })
    expect(notesOnly.form.status).toBe("unverified")
    expect(notesOnly.form.source).toBe("rejected")

    const na = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(na.form.status).toBe("pass")

    setActiveQcDesign(session, "demo")
    recordQcEvidence(session, {
      axis: "form",
      tool: "cad_analyze_form",
      ok: true,
      status: "pass",
      summary: "form pass, contract matched",
      subjects: ["shell"],
    })
    const freeform = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      form: { status: "pass", findings: ["stations match contract"] },
    })
    expect(freeform.form.status).toBe("pass")
    expect(freeform.form.source).toBe("evidence")

    // N/A rejected when prior form evidence already shows varying freeform.
    clearQcEvidenceForDesign(session, "demo")
    recordQcEvidence(session, {
      axis: "form",
      tool: "cad_analyze_form",
      ok: true,
      status: "unverified",
      summary: "form unverified, axis=Z, t_mode=from_min, 5/5 stations, varying, width_var=12.0%",
      subjects: ["shell"],
    })
    const naOnVarying = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: null,
      evidenceKey: key,
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(naOnVarying.form.status).toBe("unverified")
    expect(naOnVarying.form.source).toBe("rejected")
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

  test("rejects a pass claim when newer fail evidence overrides the earlier pass", async () => {
    const session = qcSessionKey("/engine", "/cwd-g")
    setActiveQcDesign(session, "demo")
    clearQcEvidenceForDesign(session, "demo")
    // Phase 1: in-session pass on the current shape subject.
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: true,
      status: "pass",
      summary: "0 error findings",
      subjects: ["body"],
    })
    // Phase 2: bed-pose fail on the same part (suffix-normalized to `body`).
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: false,
      status: "fail",
      summary: "overhang on body_built",
      subjects: ["body_built"],
    })
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: artifact(["body"]) as any,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-g", "demo"),
      printability: { status: "pass" },
      fit: { status: "pass", findings: ["not applicable"] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.printability.status).toBe("fail")
    expect(report.printability.source).toBe("rejected")
    expect(report.printability.findings.join(" ")).toMatch(/newer printability evidence/)
  })

  test("accepts a pass claim when the newest evidence per subject is a pass", async () => {
    const session = qcSessionKey("/engine", "/cwd-h")
    setActiveQcDesign(session, "demo")
    clearQcEvidenceForDesign(session, "demo")
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: false,
      status: "fail",
      summary: "overhang",
      subjects: ["body_built"],
    })
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: true,
      status: "pass",
      summary: "0 error findings after rework",
      subjects: ["body"],
    })
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: artifact(["body"]) as any,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-h", "demo"),
      printability: { status: "pass" },
      fit: { status: "pass", findings: ["not applicable"] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.printability.status).toBe("pass")
  })

  test("a named bed-pose fail overrides an in-session current_shape pass", async () => {
    const session = qcSessionKey("/engine", "/cwd-j")
    setActiveQcDesign(session, "demo")
    clearQcEvidenceForDesign(session, "demo")
    // In-session run without object_name records the subject as current_shape.
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: true,
      status: "pass",
      summary: "0 error findings",
      subjects: ["current_shape"],
    })
    // Bed-pose run with object_name records the named part.
    recordQcEvidence(session, {
      axis: "printability",
      tool: "cad_analyze_printability",
      ok: false,
      status: "fail",
      summary: "overhang on body_built",
      subjects: ["body_built"],
    })
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: artifact(["body"]) as any,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-j", "demo"),
      printability: { status: "pass" },
      fit: { status: "pass", findings: ["not applicable"] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.printability.status).toBe("fail")
    expect(report.printability.findings.join(" ")).toMatch(/newer printability evidence/)
  })

  test("fit pass evidence must relate to at least one design part", async () => {
    const session = qcSessionKey("/engine", "/cwd-i")
    setActiveQcDesign(session, "demo")
    clearQcEvidenceForDesign(session, "demo")
    recordQcEvidence(session, {
      axis: "fit",
      tool: "cad_compare",
      ok: true,
      status: "pass",
      summary: "apart, clearance=0.5mm",
      subjects: ["scratch_a", "scratch_b"],
    })
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: artifact(["body", "lid"]) as any,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-i", "demo"),
      printability: { status: "pass", findings: [] },
      fit: { status: "pass", findings: [] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.fit.status).toBe("unverified")
    expect(report.fit.findings.join(" ")).toMatch(/none of which are design parts/)
  })

  test("a mating-pair fit compare counts as evidence on a larger design", async () => {
    const session = qcSessionKey("/engine", "/cwd-k")
    setActiveQcDesign(session, "demo")
    clearQcEvidenceForDesign(session, "demo")
    recordQcEvidence(session, {
      axis: "fit",
      tool: "cad_compare",
      ok: true,
      status: "pass",
      summary: "apart, clearance=0.3mm",
      subjects: ["body", "lid"],
    })
    const report = await buildDesignQcReport({
      id: "demo",
      entry: { ...entry(), buildStatus: "unbuilt" },
      artifact: artifact(["body", "lid", "base"]) as any,
      evidenceKey: qcEvidenceKey("/engine", "/cwd-k", "demo"),
      printability: { status: "pass", findings: [] },
      fit: { status: "pass", findings: [] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.fit.status).toBe("pass")
  })

  test("printability subjects cannot cover stem-sharing sibling parts", async () => {
    const { subjectsCoverParts } = await import("../host/qc-evidence")
    // One analysis on `base` must not cover a distinct part named `base_side`.
    const cover = subjectsCoverParts(["base"], ["base", "base_side"])
    expect(cover.ok).toBe(false)
    expect(cover.missing).toEqual(["base_side"])
    // A pose-suffixed subject maps to the most specific part: `base_side_built`
    // covers `base_side` (not `base`), and never both parts of the pair.
    expect(subjectsCoverParts(["base_side"], ["base_side"]).ok).toBe(true)
    expect(subjectsCoverParts(["base_side_built"], ["base", "base_side"]).missing).toEqual(["base"])
    expect(subjectsCoverParts(["base_side_print"], ["base", "base_side"]).missing).toEqual(["base"])
  })
})

function listHas(session: string, designId: string) {
  return listQcEvidence(`${session}::${designId}`, "fit").length > 0
}
