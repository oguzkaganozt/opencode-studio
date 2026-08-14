import { STUDIO_TOOL_PERMISSIONS, type StudioDefinition } from "../../src/core/registry"

export const conceptStudio: StudioDefinition = {
  id: "concept",
  label: "Concept Studio",
  description: "Industrial design briefs and moodboards from a product seed.",
  skill: "studio-concept",
  toolPermissions: STUDIO_TOOL_PERMISSIONS.concept,
  requiredEngines: [],
  root: {
    default: "studio_home",
    relativePath: "studio/concepts",
    create: true,
  },
}
