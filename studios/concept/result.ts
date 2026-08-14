import { formatToolJson } from "../../src/core/format-tool-json"

export type ConceptToolStatus = "pass" | "fail" | "error"

export type ConceptToolEnvelope = {
  ok: boolean
  tool: string
  summary: string
  status: ConceptToolStatus
  data: Record<string, unknown> | null
  warnings: string[]
  next?: string[]
  error?: { code: string; message: string }
}

export function formatConceptResult(envelope: ConceptToolEnvelope) {
  return formatToolJson(envelope)
}

export function conceptPass(tool: string, summary: string, data: Record<string, unknown>, next?: string[]) {
  return formatConceptResult({ ok: true, tool, summary, status: "pass", data, warnings: [], next })
}

export function conceptFail(tool: string, code: string, message: string, data: Record<string, unknown> | null = null, next?: string[]) {
  return formatConceptResult({
    ok: false,
    tool,
    summary: message,
    status: "fail",
    data,
    warnings: [],
    next,
    error: { code, message },
  })
}
