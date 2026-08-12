export const STUDIO_IDS = ["cad", "pcb", "media", "fw"] as const
export type StudioId = (typeof STUDIO_IDS)[number]

export const STUDIO_TOOL_PERMISSIONS: Record<StudioId, readonly string[]> = {
  cad: ["cad_*"],
  pcb: ["pcb_*"],
  media: ["media_*", "fal_*", "chatgpt_image_generate", "read_media"],
  fw: ["fw_*"],
}

export const STUDIO_SKILL_NAMES = STUDIO_IDS.map((id) => `studio-${id}` as const)

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
  /** OpenCode permission selectors covering every model tool owned by the Studio. */
  toolPermissions: readonly string[]
  requiredEngines: string[]
  root: {
    default: StudioRootDefault
    /**
     * Path under Studio Home when `studio.json` has no `roots.<id>` override.
     * CAD: `studio/designs` → `$HOME/studio/designs/<id>`
     * PCB: `studio/circuits` → `$HOME/studio/circuits/<id>`
     * Media: `studio/media` → `$HOME/studio/media/<id>`
     * FW: `studio/firmware` → `$HOME/studio/firmware/<id>`
     */
    relativePath?: string
    create: boolean
  }
}

export function isStudioId(value: string): value is StudioId {
  return (STUDIO_IDS as readonly string[]).includes(value)
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
