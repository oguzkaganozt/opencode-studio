import { describe, expect, test } from "bun:test"
import { type ComponentSearchEntry, partitionSearchEntries } from "../tsci"

const jlc: ComponentSearchEntry = {
  source: "jlcpcb",
  exactMatch: false,
  lcscPartNumber: "C1",
  manufacturerPartNumber: "TYPE-C",
  packageDescription: "SMD",
  description: null,
  stock: null,
  unitPrice: null,
  isBasic: false,
  isPreferred: false,
  supplierPartNumbers: { jlcpcb: ["C1"] },
  loadability: { status: "unknown", reason: "jlcpcb_search_metadata_only" },
}

const registry: ComponentSearchEntry = {
  source: "tscircuit",
  exactMatch: true,
  packageName: "@tsci/esp32",
  version: "1.0.0",
  description: null,
  usageInstructions: "<chip footprint='...'>",
  starCount: 1,
  hasPublicDist: true,
  loadability: { status: "loadable", reason: "public_registry_release" },
  candidateId: "candidate-1",
  packageSpec: "@tsci/esp32",
  importStatement: 'import { ESP32 } from "@tsci/esp32"',
  exportName: "ESP32",
}

const kicad: ComponentSearchEntry = {
  source: "kicad",
  exactMatch: false,
  path: "Connector_USB.pretty/USB_C.kicad_mod",
  footprint: "kicad:Connector_USB/USB_C",
  loadability: { status: "loadable", reason: "kicad_cache_hit" },
}

describe("partitionSearchEntries", () => {
  test("unverified registry package is a candidate; KiCad and JLCPCB stay non-usable", () => {
    const { usable, candidates, footprintOnly, catalogOnly } = partitionSearchEntries([jlc, registry, kicad])
    expect(usable).toEqual([])
    expect(candidates).toEqual([registry])
    expect(footprintOnly).toEqual([kicad])
    expect(catalogOnly).toEqual([jlc])
  })
})
