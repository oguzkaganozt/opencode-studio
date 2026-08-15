import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runAllNetlistChecks, runAllPlacementChecks } from "@tscircuit/checks"
import { engineCommand, resolveTsci } from "../../src/core/engines"
import { canonicalExistingDirectory, isInside } from "../../src/core/paths"
import { type CircuitElement, readCircuitJson } from "./circuit-json"

export const CIRCUIT_CHECKS = ["netlist", "placement", "shorts"] as const
export type CircuitCheck = (typeof CIRCUIT_CHECKS)[number]

export const SHORTS_CONFIG = {
  mode: "gerber",
  layer: "all",
  pixelsPerMm: 50,
} as const

export const MAX_CIRCUIT_CHECK_ISSUES = 100
export const MAX_CIRCUIT_CHECK_OUTPUT_BYTES = 64 * 1024
const MAX_ISSUE_MESSAGE_LENGTH = 500
const SHORTS_TIMEOUT_MS = 60_000

export type CircuitCheckOptions = {
  checks: CircuitCheck[]
  /** Limit placement findings to one source component reference designator. */
  placementRefdes?: string
}

export type CircuitCheckInput = {
  projectDir: string
  circuitJsonPath: string
  options: CircuitCheckOptions
}

export type CircuitCheckError = {
  code: "invalid_input" | "read_failed" | "check_failed" | "engine_unavailable" | "timeout"
  message: string
}

export type CircuitCheckIssue = {
  check: CircuitCheck
  type: string
  severity: "error" | "warning"
  message: string
  refdes?: string[]
  layer?: string
  center?: { x: number; y: number }
  owners?: [string[], string[]]
  pixelCount?: number
}

export type SingleCircuitCheckResult = {
  check: CircuitCheck
  executionOk: boolean
  clean: boolean
  issues: CircuitCheckIssue[]
  issueCount: number
  omittedIssueCount: number
  outputTruncated: boolean
  error?: CircuitCheckError
}

export type CircuitCheckResult = {
  executionOk: boolean
  clean: boolean
  issues: CircuitCheckIssue[]
  issueCount: number
  omittedIssueCount: number
  checks: SingleCircuitCheckResult[]
  error?: CircuitCheckError
  shortsConfig: typeof SHORTS_CONFIG
}

export type ShortsRunnerResult = {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
  outputTruncated?: boolean
}

export type ShortsRunnerInput = {
  circuitJsonPath: string
  config: typeof SHORTS_CONFIG
}

export type CircuitCheckDependencies = {
  runNetlist: (circuitJson: CircuitElement[]) => Promise<unknown[]>
  runPlacement: (circuitJson: CircuitElement[]) => Promise<unknown[]>
  runShorts: (input: ShortsRunnerInput) => Promise<ShortsRunnerResult>
}

const defaultDependencies: CircuitCheckDependencies = {
  runNetlist: async (circuitJson) => runAllNetlistChecks(circuitJson as Parameters<typeof runAllNetlistChecks>[0]),
  runPlacement: async (circuitJson) => runAllPlacementChecks(circuitJson as Parameters<typeof runAllPlacementChecks>[0]),
  runShorts: runShortsCli,
}

function errorResult(error: CircuitCheckError): CircuitCheckResult {
  return {
    executionOk: false,
    clean: false,
    issues: [],
    issueCount: 0,
    omittedIssueCount: 0,
    checks: [],
    error,
    shortsConfig: SHORTS_CONFIG,
  }
}

function boundedMessage(value: unknown, fallback: string): string {
  const message = typeof value === "string" && value.length > 0 ? value : fallback
  return message.length <= MAX_ISSUE_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_ISSUE_MESSAGE_LENGTH - 3)}...`
}

function validateInput(input: CircuitCheckInput): CircuitCheckError | undefined {
  if (!input || typeof input !== "object") return { code: "invalid_input", message: "Circuit check input is required" }
  if (typeof input.projectDir !== "string" || input.projectDir.length === 0 || input.projectDir.includes("\0")) {
    return { code: "invalid_input", message: "projectDir must be a non-empty path" }
  }
  if (typeof input.circuitJsonPath !== "string" || input.circuitJsonPath.length === 0 || input.circuitJsonPath.includes("\0")) {
    return { code: "invalid_input", message: "circuitJsonPath must be a non-empty path" }
  }
  if (!input.options || typeof input.options !== "object" || !Array.isArray(input.options.checks) || input.options.checks.length === 0) {
    return { code: "invalid_input", message: "options.checks must be a non-empty array" }
  }
  if (input.options.checks.some((check) => !CIRCUIT_CHECKS.includes(check))) {
    return { code: "invalid_input", message: `checks must contain only: ${CIRCUIT_CHECKS.join(", ")}` }
  }
  if (new Set(input.options.checks).size !== input.options.checks.length) {
    return { code: "invalid_input", message: "options.checks must not contain duplicates" }
  }
  if (
    input.options.placementRefdes !== undefined &&
    (typeof input.options.placementRefdes !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(input.options.placementRefdes) ||
      !input.options.checks.includes("placement"))
  ) {
    return { code: "invalid_input", message: "placementRefdes must be a valid refdes and requires the placement check" }
  }
}

type RefdesIndex = {
  sourceComponents: Map<string, string>
  pcbComponents: Map<string, string>
  sourcePorts: Map<string, string>
  pcbPorts: Map<string, string>
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function buildRefdesIndex(circuitJson: CircuitElement[]): RefdesIndex {
  const sourceComponents = new Map<string, string>()
  for (const element of circuitJson) {
    if (element.type !== "source_component") continue
    const id = stringValue(element.source_component_id)
    const name = stringValue(element.name)
    if (id && name) sourceComponents.set(id, name)
  }

  const pcbComponents = new Map<string, string>()
  for (const element of circuitJson) {
    if (element.type !== "pcb_component") continue
    const id = stringValue(element.pcb_component_id)
    const refdes = sourceComponents.get(stringValue(element.source_component_id) ?? "")
    if (id && refdes) pcbComponents.set(id, refdes)
  }

  const sourcePorts = new Map<string, string>()
  const pcbPorts = new Map<string, string>()
  for (const element of circuitJson) {
    if (element.type === "source_port") {
      const id = stringValue(element.source_port_id)
      const refdes = sourceComponents.get(stringValue(element.source_component_id) ?? "")
      if (id && refdes) sourcePorts.set(id, refdes)
    } else if (element.type === "pcb_port") {
      const id = stringValue(element.pcb_port_id)
      const refdes = sourcePorts.get(stringValue(element.source_port_id) ?? "")
      if (id && refdes) pcbPorts.set(id, refdes)
    }
  }
  return { sourceComponents, pcbComponents, sourcePorts, pcbPorts }
}

function collectIds(record: Record<string, unknown>, singular: string, plural: string): string[] {
  const values = Array.isArray(record[plural]) ? record[plural] : [record[singular]]
  return values.filter((value): value is string => typeof value === "string")
}

function issueRefdes(record: Record<string, unknown>, index: RefdesIndex): string[] {
  const refs = new Set<string>()
  const direct = record.refdes
  if (typeof direct === "string") refs.add(direct)
  for (const id of collectIds(record, "source_component_id", "source_component_ids")) {
    const refdes = index.sourceComponents.get(id)
    if (refdes) refs.add(refdes)
  }
  for (const id of collectIds(record, "pcb_component_id", "pcb_component_ids")) {
    const refdes = index.pcbComponents.get(id)
    if (refdes) refs.add(refdes)
  }
  for (const id of collectIds(record, "source_port_id", "source_port_ids")) {
    const refdes = index.sourcePorts.get(id)
    if (refdes) refs.add(refdes)
  }
  for (const id of collectIds(record, "pcb_port_id", "pcb_port_ids")) {
    const refdes = index.pcbPorts.get(id)
    if (refdes) refs.add(refdes)
  }
  return [...refs].sort().slice(0, 8)
}

function normalizeApiIssues(check: "netlist" | "placement", values: unknown[], index: RefdesIndex): CircuitCheckIssue[] {
  const issues = values.map((value): CircuitCheckIssue => {
    const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    const type = stringValue(record.type) ?? stringValue(record.error_type) ?? "unknown_issue"
    const refdes = issueRefdes(record, index)
    return {
      check,
      type,
      severity: type.includes("warning") ? "warning" : "error",
      message: boundedMessage(record.message, type),
      ...(refdes.length > 0 ? { refdes } : {}),
    }
  })
  return issues.sort((a, b) =>
    `${a.type}\0${a.message}\0${a.refdes?.join(",") ?? ""}`.localeCompare(`${b.type}\0${b.message}\0${b.refdes?.join(",") ?? ""}`),
  )
}

function capIssues(check: CircuitCheck, issues: CircuitCheckIssue[], outputTruncated = false): SingleCircuitCheckResult {
  return {
    check,
    executionOk: true,
    clean: issues.length === 0,
    issues: issues.slice(0, MAX_CIRCUIT_CHECK_ISSUES),
    issueCount: issues.length,
    omittedIssueCount: Math.max(0, issues.length - MAX_CIRCUIT_CHECK_ISSUES),
    outputTruncated,
  }
}

function failedCheck(check: CircuitCheck, error: CircuitCheckError, outputTruncated = false): SingleCircuitCheckResult {
  return {
    check,
    executionOk: false,
    clean: false,
    issues: [],
    issueCount: 0,
    omittedIssueCount: 0,
    outputTruncated,
    error,
  }
}

function parseOwners(value: string): string[] {
  if (value === "(unknown)") return []
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
}

function parseShorts(result: ShortsRunnerResult): SingleCircuitCheckResult {
  if (result.timedOut) return failedCheck("shorts", { code: "timeout", message: `Shorts check timed out after ${SHORTS_TIMEOUT_MS}ms` })

  const detected = result.stdout.match(/^Detected (\d+) shorts?\b/m)
  if (!detected) {
    if (result.exitCode === 0 && /^No shorts detected\b/m.test(result.stdout)) return capIssues("shorts", [], result.outputTruncated)
    return failedCheck(
      "shorts",
      { code: "check_failed", message: boundedMessage(result.stderr, "Shorts check returned an unrecognized result") },
      result.outputTruncated,
    )
  }

  const total = Number(detected[1])
  const lines = result.stdout.split(/\r?\n/)
  const issues: CircuitCheckIssue[] = []
  const header = /^\d+\. (top|bottom|inner[1-8])\/gerber short at x=(-?\d+(?:\.\d+)?)mm y=(-?\d+(?:\.\d+)?)mm$/
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const match = lines[lineIndex]?.match(header)
    if (!match) continue
    const ownerPair = lines[lineIndex + 1]?.trim().split(" <-> ")
    const pixelMatch = lines[lineIndex + 2]?.trim().match(/^pixels=(\d+)$/)
    if (ownerPair?.length !== 2 || !pixelMatch) continue
    const owners: [string[], string[]] = [parseOwners(ownerPair[0]!), parseOwners(ownerPair[1]!)]
    issues.push({
      check: "shorts",
      type: "pcb_short",
      severity: "error",
      message: boundedMessage(`Unintended copper connection: ${ownerPair[0]} <-> ${ownerPair[1]}`, "PCB short"),
      layer: match[1],
      center: { x: Number(match[2]), y: Number(match[3]) },
      owners,
      pixelCount: Number(pixelMatch[1]),
    })
  }
  if (!Number.isSafeInteger(total) || total < 1 || issues.length === 0 || issues.length > total) {
    return failedCheck(
      "shorts",
      { code: "check_failed", message: "Shorts check output did not contain complete structured findings" },
      result.outputTruncated,
    )
  }
  if (result.exitCode !== 1) {
    return failedCheck(
      "shorts",
      { code: "check_failed", message: `Shorts check exited with unexpected code ${result.exitCode}` },
      result.outputTruncated,
    )
  }
  const capped = capIssues("shorts", issues, result.outputTruncated)
  capped.issueCount = total
  capped.omittedIssueCount = Math.max(0, total - capped.issues.length)
  capped.clean = false
  return capped
}

async function consumeLimited(stream: ReadableStream<Uint8Array>): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let retained = 0
  let truncated = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (retained < MAX_CIRCUIT_CHECK_OUTPUT_BYTES) {
      const remaining = MAX_CIRCUIT_CHECK_OUTPUT_BYTES - retained
      const chunk = value.byteLength <= remaining ? value : value.subarray(0, remaining)
      chunks.push(chunk)
      retained += chunk.byteLength
      if (value.byteLength > remaining) truncated = true
    } else if (value.byteLength > 0) {
      truncated = true
    }
  }
  const output = new Uint8Array(retained)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(output), truncated }
}

async function runShortsCli(input: ShortsRunnerInput): Promise<ShortsRunnerResult> {
  const engine = resolveTsci()
  if (engine?.source !== "bundled") throw new Error("Pinned bundled tscircuit CLI is unavailable")
  const workingDir = await mkdtemp(path.join(tmpdir(), "opencode-pcb-check-"))
  let timedOut = false
  try {
    const proc = Bun.spawn(
      [
        ...engineCommand(engine),
        "check",
        "shorts",
        input.circuitJsonPath,
        "--mode",
        input.config.mode,
        "--layer",
        input.config.layer,
        "--pixels-per-mm",
        String(input.config.pixelsPerMm),
      ],
      {
        cwd: workingDir,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TSCI_TEST_MODE: "true" },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, SHORTS_TIMEOUT_MS)
    try {
      const [stdout, stderr, exitCode] = await Promise.all([consumeLimited(proc.stdout), consumeLimited(proc.stderr), proc.exited])
      return {
        exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        timedOut,
        outputTruncated: stdout.truncated || stderr.truncated,
      }
    } finally {
      clearTimeout(timer)
    }
  } finally {
    await rm(workingDir, { recursive: true, force: true })
  }
}

/** Run deterministic, side-effect-free checks against a prebuilt circuit JSON file. */
export async function checkCircuit(
  input: CircuitCheckInput,
  dependencies: Partial<CircuitCheckDependencies> = {},
): Promise<CircuitCheckResult> {
  const validationError = validateInput(input)
  if (validationError) return errorResult(validationError)

  let projectDir: string
  let circuitJsonPath: string
  let circuitJson: CircuitElement[]
  try {
    const requestedProjectDir = path.resolve(input.projectDir)
    projectDir = await canonicalExistingDirectory(input.projectDir, "projectDir")
    if (path.isAbsolute(input.circuitJsonPath)) {
      const requestedCircuitJsonPath = path.normalize(input.circuitJsonPath)
      circuitJsonPath = isInside(requestedProjectDir, requestedCircuitJsonPath)
        ? path.resolve(projectDir, path.relative(requestedProjectDir, requestedCircuitJsonPath))
        : requestedCircuitJsonPath
    } else {
      circuitJsonPath = path.resolve(projectDir, input.circuitJsonPath)
    }
    if (!isInside(projectDir, circuitJsonPath))
      return errorResult({ code: "invalid_input", message: "circuitJsonPath must be inside projectDir" })
    circuitJson = await readCircuitJson(projectDir, circuitJsonPath)
  } catch (error) {
    return errorResult({
      code: "read_failed",
      message: boundedMessage(error instanceof Error ? error.message : error, "Unable to read circuit JSON"),
    })
  }

  const deps = { ...defaultDependencies, ...dependencies }
  const index = buildRefdesIndex(circuitJson)
  const selectedRefdes = input.options.placementRefdes
  if (selectedRefdes && ![...index.sourceComponents.values()].includes(selectedRefdes)) {
    return errorResult({ code: "invalid_input", message: `placementRefdes not found: ${selectedRefdes}` })
  }

  const requested = new Set(input.options.checks)
  const checks: SingleCircuitCheckResult[] = []
  for (const check of CIRCUIT_CHECKS) {
    if (!requested.has(check)) continue
    try {
      if (check === "shorts") {
        checks.push(parseShorts(await deps.runShorts({ circuitJsonPath, config: SHORTS_CONFIG })))
      } else {
        const values = check === "netlist" ? await deps.runNetlist(circuitJson) : await deps.runPlacement(circuitJson)
        let issues = normalizeApiIssues(check, values, index)
        if (check === "placement" && selectedRefdes) issues = issues.filter((issue) => issue.refdes?.includes(selectedRefdes))
        checks.push(capIssues(check, issues))
      }
    } catch (error) {
      const unavailable = check === "shorts" && error instanceof Error && error.message.includes("bundled tscircuit CLI")
      checks.push(
        failedCheck(check, {
          code: unavailable ? "engine_unavailable" : "check_failed",
          message: boundedMessage(error instanceof Error ? error.message : error, `${check} check failed`),
        }),
      )
    }
  }

  const issues = checks.flatMap((check) => check.issues)
  const executionOk = checks.every((check) => check.executionOk)
  const firstError = checks.find((check) => check.error)?.error
  return {
    executionOk,
    clean: executionOk && checks.every((check) => check.clean),
    issues,
    issueCount: checks.reduce((sum, check) => sum + check.issueCount, 0),
    omittedIssueCount: checks.reduce((sum, check) => sum + check.omittedIssueCount, 0),
    checks,
    ...(firstError ? { error: firstError } : {}),
    shortsConfig: SHORTS_CONFIG,
  }
}
