import { STUDIO_TOOL_PERMISSIONS, type StudioDefinition } from "../../src/core/registry"

export const fwStudio: StudioDefinition = {
  id: "fw",
  label: "Firmware Studio",
  description: "ESP-IDF firmware build and UART simulation on QEMU or esp-emu.",
  skill: "studio-fw",
  toolPermissions: STUDIO_TOOL_PERMISSIONS.fw,
  requiredEngines: [],
  root: {
    default: "studio_home",
    relativePath: "studio/firmware",
    create: true,
  },
}
