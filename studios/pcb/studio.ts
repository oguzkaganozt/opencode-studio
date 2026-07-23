import type { StudioDefinition } from "../../src/core/registry"

export const pcbStudio: StudioDefinition = {
  id: "pcb",
  label: "PCB Studio",
  description: "tscircuit schematic/PCB design, manufacturing checks, BOM, and CPL.",
  skill: "pcb-studio",
  requiredEngines: ["tsci"],
  root: {
    default: "workspace",
    create: false,
  },
}
