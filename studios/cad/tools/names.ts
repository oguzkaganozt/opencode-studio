/** Public CAD tool namespace owned by OpenCode Studio. */

export const CAD_TOOL_PREFIX = "cad_" as const

/** Engine catalog entries registered as agent-facing cad_* tools. */
export const CAD_SESSION_ALLOWLIST = [
  "execute",
  "validate",
  "measure",
  "compare",
  "analyze_printability",
  "analyze_form",
  "render_view",
  "reset",
] as const

/** Session/geometry tools from the engine catalog → public cad_* names. */
export function cadSessionToolName(entryName: string): string {
  return `${CAD_TOOL_PREFIX}${entryName}`
}
