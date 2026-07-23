import type { StudioDefinition } from "../../src/core/registry"

export const cadStudio: StudioDefinition = {
  id: "cad",
  label: "CAD Studio",
  description: "FDM-printable multi-part CAD products with build123d and Forge.",
  skill: "cad-studio",
  requiredEngines: ["uv"],
  root: {
    default: "workspace",
    create: false,
  },
}
