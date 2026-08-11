import { STUDIO_TOOL_PERMISSIONS, type StudioDefinition } from "../../src/core/registry"

export const cadStudio: StudioDefinition = {
  id: "cad",
  label: "CAD Studio",
  description: "FDM-printable multi-part CAD products with build123d and Forge.",
  skill: "studio-cad",
  toolPermissions: STUDIO_TOOL_PERMISSIONS.cad,
  requiredEngines: ["uv"],
  root: {
    default: "studio_home",
    relativePath: "studio/designs",
    create: true,
  },
}
