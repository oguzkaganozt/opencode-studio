export const STUDIO_IDS = ["cad", "media", "pcb", "startup"] as const
export type StudioId = (typeof STUDIO_IDS)[number]

export type StudioRootDefault = "workspace" | "user-data"

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
  doctor?: () => Promise<StudioDoctorCheck[]>
}

export function isStudioId(value: string): value is StudioId {
  return (STUDIO_IDS as readonly string[]).includes(value)
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
