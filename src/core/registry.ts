export const STUDIO_IDS = ["cad", "pcb"] as const
export type StudioId = (typeof STUDIO_IDS)[number]

/** Legacy studio ids stripped from config with a warning. */
export const LEGACY_STUDIO_IDS = ["media", "startup"] as const

export type StudioRootDefault = "studio_home"

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
    /**
     * Path under Studio Home when `studio.json` has no `roots.<id>` override.
     * CAD: `studio/designs` → `$HOME/studio/designs/<id>`
     * PCB: `studio/circuits` → `$HOME/studio/circuits/<id>`
     */
    relativePath?: string
    create: boolean
  }
}

export function isStudioId(value: string): value is StudioId {
  return (STUDIO_IDS as readonly string[]).includes(value)
}

export function isLegacyStudioId(value: string): boolean {
  return (LEGACY_STUDIO_IDS as readonly string[]).includes(value)
}

/** Ensure a key set matches STUDIO_IDS exactly (order-independent). */
export function assertCatalogComplete(ids: string[], label: string) {
  const expected = [...STUDIO_IDS].sort()
  const actual = [...new Set(ids)].sort()
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error(`${label} must match catalog exactly. expected=${expected.join(",")} actual=${actual.join(",")}`)
  }
}

/** Platform contribution owner (not a catalog studio). */
export const PLATFORM_OWNER = "platform" as const
export type PluginOwner = StudioId | typeof PLATFORM_OWNER
