import { STUDIO_TOOL_PERMISSIONS, type StudioDefinition } from "../../src/core/registry"

export const pcbStudio: StudioDefinition = {
  id: "pcb",
  label: "PCB Studio",
  description: "tscircuit schematic/PCB design, manufacturing checks, BOM, and CPL.",
  skill: "studio-pcb",
  toolPermissions: STUDIO_TOOL_PERMISSIONS.pcb,
  requiredEngines: ["tsci"],
  root: {
    default: "studio_home",
    relativePath: "studio/circuits",
    create: true,
  },
}
