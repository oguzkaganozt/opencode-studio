import { STUDIO_TOOL_PERMISSIONS, type StudioDefinition } from "../../src/core/registry"

export const mediaStudio: StudioDefinition = {
  id: "media",
  label: "Media Studio",
  description: "Project-scoped image, audio, and video generation, conversion, and inspection.",
  skill: "studio-media",
  toolPermissions: STUDIO_TOOL_PERMISSIONS.media,
  requiredEngines: ["ffmpeg", "ffprobe"],
  root: {
    default: "studio_home",
    relativePath: "studio/media",
    create: true,
  },
}
