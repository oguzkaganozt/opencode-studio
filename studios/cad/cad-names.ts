/** Public CAD tool namespace owned by OpenCode Studio. */

export const CAD_TOOL_PREFIX = "cad_" as const

/** Lifecycle tools previously exposed as design_*. */
export function cadDesignToolName(suffix: string): string {
  return `${CAD_TOOL_PREFIX}design_${suffix}`
}

/** Session/geometry tools previously exposed as build123d_*. */
export function cadSessionToolName(entryName: string): string {
  return `${CAD_TOOL_PREFIX}${entryName}`
}

/** Map a legacy internal name to the public cad_* name. */
export function toPublicCadToolName(name: string): string {
  if (name.startsWith("design_")) return `${CAD_TOOL_PREFIX}${name}`
  if (name.startsWith("build123d_")) return `${CAD_TOOL_PREFIX}${name.slice("build123d_".length)}`
  return name
}
