export const STUDIO_IDS = ["cad", "pcb"] as const
export type StudioId = (typeof STUDIO_IDS)[number]

/** Legacy studio ids stripped from config with a warning. */
export const LEGACY_STUDIO_IDS = ["media", "startup"] as const

export type StudioRootDefault = "workspace"

export type StudioDoctorCheck = {
  id: string
  status: "pass" | "warn" | "fail"
  message: string
  source?: string
  repair?: string
}

export type StudioDefinition = {
  id: StudioId
  label: string
  description: string
  skill: string
  requiredEngines: string[]
  root: {
    default: StudioRootDefault
    create: boolean
  }
}

export function isStudioId(value: string): value is StudioId {
  return (STUDIO_IDS as readonly string[]).includes(value)
}

export function isLegacyStudioId(value: string): boolean {
  return (LEGACY_STUDIO_IDS as readonly string[]).includes(value)
}

export function assertStudioIds(values: string[]): StudioId[] {
  const seen = new Set<string>()
  const result: StudioId[] = []
  for (const value of values) {
    if (!isStudioId(value)) throw new Error(`Unknown Studio ID: ${value}`)
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/** Catalog order used for deterministic hook composition. */
export const CATALOG_ORDER: StudioId[] = [...STUDIO_IDS]

/** Platform contribution owner (not a catalog studio). */
export const PLATFORM_OWNER = "platform" as const
export type PluginOwner = StudioId | typeof PLATFORM_OWNER
