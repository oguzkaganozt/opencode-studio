/** Public CAD tool namespace owned by OpenCode Studio. */

export const CAD_TOOL_PREFIX = "cad_" as const

/** Session/geometry tools from the engine catalog → public cad_* names. */
export function cadSessionToolName(entryName: string): string {
  return `${CAD_TOOL_PREFIX}${entryName}`
}
