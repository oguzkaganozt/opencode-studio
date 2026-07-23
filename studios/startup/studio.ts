import type { StudioDefinition } from "../../src/core/registry"

export const startupStudio: StudioDefinition = {
  id: "startup",
  label: "Startup Studio",
  description: "Idea mining, evidence checks, and scored candidate pool management.",
  skill: "startup-studio",
  requiredEngines: [],
  root: {
    default: "workspace",
    create: false,
  },
}
