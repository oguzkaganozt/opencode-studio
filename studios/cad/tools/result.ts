import { formatToolJson } from "../../../src/core/format-tool-json"

export type CadToolStatus = "pass" | "fail" | "unverified" | "error"

export type CadToolEnvelope = {
  ok: boolean
  tool: string
  summary: string
  status: CadToolStatus
  data: Record<string, unknown> | null
  warnings: string[]
  next?: string[]
  error?: { code: string; message: string }
}

export const CAD_SESSION_STRUCTURED_TOOLS = new Set(["validate", "measure", "compare", "analyze_printability", "analyze_form"])

const MAX_BYTES = 60_000

/** Extract the first balanced JSON value from MCP text that may have a prose prefix. */
export function extractFirstJson(text: string): { prefix: string; value: unknown } | null {
  const start = text.search(/[{[]/)
  if (start < 0) return null
  const open = text[start]!
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inString = false
  let inEscape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      if (inEscape) inEscape = false
      else if (c === "\\") inEscape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        const slice = text.slice(start, i + 1)
        try {
          return { prefix: text.slice(0, start).trim(), value: JSON.parse(slice) }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export function formatCadToolResult(envelope: CadToolEnvelope, maxBytes = MAX_BYTES): string {
  return formatToolJson(envelope, { maxBytes })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter(Boolean)
}

export function structureCadSessionResult(input: {
  entryName: string
  toolName: string
  text: string
  isError: boolean
  args?: Record<string, unknown>
}): CadToolEnvelope {
  const { entryName, toolName, text, isError, args = {} } = input
  if (isError) {
    return {
      ok: false,
      tool: toolName,
      summary: text.trim().slice(0, 240) || `${toolName} failed`,
      status: "error",
      data: null,
      warnings: [],
      next: entryName === "validate" ? ["cad_last_error", "cad_repair_hints"] : ["cad_last_error"],
      error: { code: "tool_error", message: text.trim() || `${toolName} failed` },
    }
  }

  const extracted = extractFirstJson(text)
  if (!extracted) {
    return {
      ok: false,
      tool: toolName,
      summary: text.trim().slice(0, 240) || `${toolName} returned no JSON`,
      status: "error",
      data: { raw: text },
      warnings: ["Could not parse structured JSON from tool output"],
      error: { code: "parse_error", message: "Expected JSON payload in tool output" },
    }
  }

  const data = asRecord(extracted.value)
  if (!data) {
    return {
      ok: true,
      tool: toolName,
      summary: extracted.prefix || `${toolName} ok`,
      status: "pass",
      data: { value: extracted.value },
      warnings: [],
    }
  }

  if (typeof data.error === "string" && data.error.length > 0) {
    return {
      ok: false,
      tool: toolName,
      summary: data.error,
      status: "fail",
      data,
      warnings: stringList(data.warnings),
      next: ["cad_session_state"],
      error: { code: "tool_reported_error", message: data.error },
    }
  }

  switch (entryName) {
    case "validate":
      return normalizeValidate(toolName, data, extracted.prefix)
    case "measure":
      return normalizeMeasure(toolName, data, extracted.prefix)
    case "compare":
      return normalizeCompare(toolName, data, extracted.prefix, args)
    case "analyze_printability":
      return normalizePrintability(toolName, data, extracted.prefix)
    case "analyze_form":
      return normalizeForm(toolName, data, extracted.prefix)
    default:
      return {
        ok: true,
        tool: toolName,
        summary: extracted.prefix || `${toolName} ok`,
        status: "pass",
        data,
        warnings: stringList(data.warnings),
      }
  }
}

function normalizeValidate(toolName: string, data: Record<string, unknown>, prefix: string): CadToolEnvelope {
  const passes = data.passes_gate === true
  const reasons = stringList(data.reasons)
  const warnings = stringList(data.warnings)
  return {
    ok: passes,
    tool: toolName,
    summary: prefix || (passes ? "Validity gate: PASS" : `Validity gate: FAIL${reasons.length ? ` — ${reasons.join("; ")}` : ""}`),
    status: passes ? "pass" : "fail",
    data,
    warnings,
    next: passes ? ["cad_measure", "cad_analyze_printability"] : ["cad_locate_gate_defects", "cad_repair_hints"],
  }
}

function normalizeMeasure(toolName: string, data: Record<string, unknown>, prefix: string): CadToolEnvelope {
  const volume = typeof data.volume === "number" ? data.volume : null
  const topo = asRecord(data.topology)
  const faces = typeof topo?.faces === "number" ? topo.faces : null
  const bbox = asRecord(data.bbox)
  const size =
    bbox && typeof bbox.xsize === "number" && typeof bbox.ysize === "number" && typeof bbox.zsize === "number"
      ? `${bbox.xsize}×${bbox.ysize}×${bbox.zsize} mm`
      : null
  const parts = [
    volume !== null ? `volume=${volume} mm³` : null,
    faces !== null ? `${faces} faces` : null,
    size ? `bbox ${size}` : null,
  ].filter(Boolean)
  return {
    ok: volume !== null,
    tool: toolName,
    summary: prefix || (parts.length ? parts.join(", ") : "measure ok"),
    status: volume !== null ? "pass" : "fail",
    data,
    warnings: [],
    next: ["cad_validate", "cad_analyze_printability"],
  }
}

function normalizeCompare(toolName: string, data: Record<string, unknown>, prefix: string, args: Record<string, unknown>): CadToolEnvelope {
  const kind = String(args.kind ?? "shape").toLowerCase()
  const warnings = stringList(data.warnings)

  if (kind === "fit") {
    const status = typeof data.status === "string" ? data.status : "unknown"
    const clearance = typeof data.clearance === "number" ? data.clearance : null
    const fitQuality = typeof data.fit_quality === "string" ? data.fit_quality : null
    const gapVerified = data.gap_verified === true
    const interpenetrating = status === "interpenetrating" || fitQuality === "clash"
    const touching = status === "touching" || fitQuality === "contact"
    const nested = status === "containing" || fitQuality === "nested"
    const summary =
      prefix ||
      `fit status=${status}${clearance !== null ? `, clearance=${clearance} mm` : ""}${
        fitQuality ? `, quality=${fitQuality}` : ""
      } (global min; seat contact ≠ snug interface gap)`
    if (interpenetrating) {
      warnings.push("interpenetrating: unintended overlap is a failure unless the design explicitly requires it")
    }
    if (touching) {
      warnings.push(
        "seat contact only (gap_verified=false): does not prove snug/moving clearance at a lip or rail — isolate mating solids or accept contact-only fit",
      )
    }
    if (nested) {
      warnings.push("one body nested in the other; clearance is wall thickness, not a press-fit lip gap")
    }
    // pass only when a positive gap is measured, or nested containment without clash.
    // touching/contact is ok as a tool result but not QC fit-pass evidence.
    let envelopeStatus: "pass" | "fail" | "unverified" = "unverified"
    if (interpenetrating) envelopeStatus = "fail"
    else if (gapVerified || nested) envelopeStatus = "pass"
    else if (touching) envelopeStatus = "unverified"
    else if (status === "apart") envelopeStatus = gapVerified ? "pass" : "unverified"
    return {
      ok: !interpenetrating,
      tool: toolName,
      summary,
      status: envelopeStatus,
      data: { ...data, kind: "fit", gap_verified: gapVerified, fit_quality: fitQuality ?? status },
      warnings,
      next: touching
        ? [
            "cad_compare kind=fit on isolated lip/cavity solids to verify snug gap",
            "or claim fit with contact-only findings (gap unverified)",
          ]
        : ["cad_compare kind=align", "cad_analyze_printability on bed pose"],
    }
  }

  if (kind === "align") {
    const delta = typeof data.delta === "number" ? data.delta : null
    return {
      ok: true,
      tool: toolName,
      summary: prefix || `align delta=${delta ?? "n/a"} axis=${String(args.axis ?? "Z")} mode=${String(args.mode ?? "flush")}`,
      status: "pass",
      data: { ...data, kind: "align" },
      warnings,
      next: [],
    }
  }

  return {
    ok: !("error" in data),
    tool: toolName,
    summary: prefix || `compare kind=${kind}`,
    status: "error" in data ? "fail" : "pass",
    data: { ...data, kind },
    warnings,
    next: [],
  }
}

function normalizeForm(toolName: string, data: Record<string, unknown>, prefix: string): CadToolEnvelope {
  const statusRaw = typeof data.status === "string" ? data.status.toLowerCase() : "unverified"
  const status: CadToolStatus = statusRaw === "pass" || statusRaw === "fail" || statusRaw === "unverified" ? statusRaw : "unverified"
  const stations = Array.isArray(data.stations) ? data.stations : []
  const comparisons = Array.isArray(data.comparisons) ? data.comparisons : []
  const mismatched = comparisons.filter((row) => {
    const r = asRecord(row)
    return r ? r.ok === false : false
  }).length
  const character = typeof data.character === "string" ? data.character : "unknown"
  const contractMatched = data.contract_matched === true
  const summary =
    prefix ||
    `form ${status}: ${stations.length} station(s), ${character}` +
      (comparisons.length ? `, contract_mismatches=${mismatched}` : ", no contract")
  const warnings = stringList(data.warnings)
  if (!contractMatched && status !== "pass") {
    warnings.push("Freeform QC pass needs contract match via cad_analyze_form; prismatic uses form finding 'not applicable'")
  }
  return {
    ok: status !== "fail",
    tool: toolName,
    summary,
    status,
    data: {
      ...data,
      station_count: stations.length,
      mismatch_count: mismatched,
      contract_matched: contractMatched,
    },
    warnings,
    next:
      status === "pass"
        ? ["cad_form_review (optional visual feedback)", "cad_design_qc_report form pass"]
        : status === "unverified"
          ? ["Provide contract='t:widthxdepth,...' from form brief", "Re-run cad_analyze_form"]
          : ["Adjust loft/sweep stations or contract targets", "Re-run cad_analyze_form"],
  }
}

function normalizePrintability(toolName: string, data: Record<string, unknown>, prefix: string): CadToolEnvelope {
  const findings = Array.isArray(data.findings) ? data.findings : []
  const normalized = findings.map((item) => {
    const row = asRecord(item) ?? {}
    return {
      kind: typeof row.kind === "string" ? row.kind : "unknown",
      severity: typeof row.severity === "string" ? row.severity.toLowerCase() : "info",
      message: typeof row.message === "string" ? row.message : String(item),
    }
  })
  const errors = normalized.filter((f) => f.severity === "error")
  const warnFindings = normalized.filter((f) => f.severity === "warning")
  const ok = errors.length === 0
  const summary =
    prefix ||
    (ok
      ? warnFindings.length
        ? `printability pass with ${warnFindings.length} warning(s)`
        : "printability pass — 0 error findings"
      : `printability fail — ${errors.length} error finding(s)`)
  return {
    ok,
    tool: toolName,
    summary,
    status: ok ? "pass" : "fail",
    data: {
      ...data,
      findings: normalized,
      error_count: errors.length,
      warning_count: warnFindings.length,
      orientation_note: "Current world orientation is treated as print orientation",
    },
    warnings: [...warnFindings.map((f) => f.message), "Reorient to bed pose before citing printability for QC"],
    next: ok ? ["cad_design_build when sources are saved"] : ["Fix geometry in cad_execute", "Re-run analyze_printability"],
  }
}

export function designCreateResult(input: {
  id: string
  designDir: string
  parts: Array<{ id: string; source?: string }>
  dispatch?: { mode: "serial" | "parallel"; workers: Array<{ partId: string; sessionID?: string; error?: string }>; remaining: string[] }
}): CadToolEnvelope {
  const dispatched = input.dispatch?.mode === "parallel" && (input.dispatch.workers?.some((worker) => worker.sessionID) ?? false)
  return {
    ok: true,
    tool: "cad_design_create",
    summary: dispatched
      ? `Scaffolded design "${input.id}" and dispatched ${input.dispatch!.workers.filter((worker) => worker.sessionID).length} cad-part worker(s)`
      : `Scaffolded design "${input.id}" with ${input.parts.length} part(s)`,
    status: "pass",
    data: {
      id: input.id,
      directory: input.designDir,
      parts: input.parts,
      dispatch: input.dispatch,
    },
    warnings: [],
    next: dispatched
      ? [
          "Do not model assigned worker parts",
          "cad_design_join until pending is empty",
          ...(input.dispatch!.remaining.length > 0 ? ["Model remaining parts here or cad_design_dispatch"] : []),
          "cad_design_build",
        ]
      : [
          "Write shared dimensions into params.py if you did not pass params",
          "Model the part with cad_execute then save parts/*.py",
          "cad_design_build when sources are ready",
        ],
  }
}

export function designBuildSuccessResult(input: {
  id: string
  revision: string
  manifestPath: string
  designDir: string
  parts: Array<{ id: string; stepPath: string; metrics: unknown }>
}): CadToolEnvelope {
  return {
    ok: true,
    tool: "cad_design_build",
    summary: "Build succeeded; design verification was not performed.",
    status: "pass",
    data: {
      id: input.id,
      revision: input.revision,
      manifestPath: input.manifestPath,
      designDir: input.designDir,
      parts: input.parts,
    },
    warnings: ["Assembly fit, printability, and form QC were not run by cad_design_build."],
    next: [
      "Import built STEP files into the session for fit/printability checks",
      "cad_design_read for metrics",
      "cad_design_qc_report with real axis statuses before claiming complete",
    ],
  }
}

export function designBuildFailureResult(input: {
  id: string
  exitCode: number
  designDir: string
  stdout: string
  stderr: string
}): CadToolEnvelope {
  const message = extractBuildFailureMessage(input.stderr, input.stdout)
  return {
    ok: false,
    tool: "cad_design_build",
    summary: `Build failed (exit ${input.exitCode})${message ? `: ${message}` : ""}`,
    status: "fail",
    data: {
      id: input.id,
      exitCode: input.exitCode,
      designDir: input.designDir,
      preservedPrevious: true,
      stdout: input.stdout,
      stderr: input.stderr,
      errors: message ? [{ message }] : [],
    },
    warnings: ["Previous generated artifacts were preserved."],
    next: ["Fix parts/*.py / params.py sources", "Reproduce with cad_execute + validate before rebuilding", "cad_design_build"],
    error: { code: "build_failed", message: message || `exit ${input.exitCode}` },
  }
}

function extractBuildFailureMessage(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const hit = lines.find((line) => /error|exception|traceback|failed|invalid/i.test(line) && line.length < 300) ?? lines[lines.length - 1]
  return hit ?? ""
}
