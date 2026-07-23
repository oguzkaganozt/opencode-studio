import type { StudioDefinition } from "../../src/core/registry"

export const mediaStudio: StudioDefinition = {
  id: "media",
  label: "Media Studio",
  description: "Native audio/video input, ChatGPT images, fal generation, and Library tools.",
  skill: "media-studio",
  requiredEngines: ["ffmpeg", "ffprobe"],
  root: {
    default: "user-data",
    create: true,
  },
}
