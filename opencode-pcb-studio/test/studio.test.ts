import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { generatePickAndPlace, toCplCsv } from "../src/assembly"
import { generateBom, toBomCsv } from "../src/bom"
import { inspectCatalog } from "../src/catalog"
import {
  elementTypeCounts,
  inspectCircuitJson,
  manufacturingBlockers,
  parseCircuitJson,
  queryCircuitJson,
  selectCircuitElements,
} from "../src/circuit-json"
import { resolveCompanionRoot } from "../src/cli"
import { createPcbStudioPlugin } from "../src/plugin"
import { validateProjectName } from "../src/scaffold"
import { createPcbStudioApp } from "../src/server"
import { isInside } from "../src/studio-path"
import {
  classifyRegistryLoadability,
  combineComponentSearchResults,
  componentSearchFallbackQuery,
  exportCircuit,
  kicadCacheUrl,
  kicadFootprint,
  parseComponentSearchOutput,
  probeKicadLoadability,
  runProjectBuild,
  searchComponents,
  serializeNpmExec,
} from "../src/tsci"
import { decodeProjectId, encodeProjectId } from "../src/workspace"
import { checkCadAssetHealth, preferKicadStepModels } from "../ui/src/cad-models"

function testApp(workspaceRoot: string) {
  return createPcbStudioApp({
    workspaceRoot,
    hostname: "127.0.0.1",
    port: 4174,
    studioId: "pcb",
    packageVersion: "0.0.0-test",
    contractVersion: "1.0.0",
  })
}

async function api(app: ReturnType<typeof createPcbStudioApp>, path: string) {
  return app.request(path, { headers: { Host: "127.0.0.1:4174" } })
}

describe("workspace selection", () => {
  test("scopes plugin tools to the active OpenCode directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-plugin-workspace-"))
    try {
      const hooks = await createPcbStudioPlugin()({ directory: workspaceRoot } as any, {
        workspaceRoot: "/ignored/legacy/config",
      })
      const output = await hooks.tool?.pcb_workspace_list.execute({}, {} as any)
      expect(typeof output).toBe("string")
      expect(JSON.parse(output as string).workspaceRoot).toBe(workspaceRoot)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  test("resolves companion --root against cwd", () => {
    expect(resolveCompanionRoot(".", "/work/current")).toBe("/work/current")
    expect(resolveCompanionRoot("../boards", "/work/current")).toBe("/work/boards")
    expect(() => resolveCompanionRoot(undefined, "/work/current")).toThrow(/--root/)
  })
})

describe("project id encoding", () => {
  test("roundtrips workspace-relative paths", () => {
    for (const rel of ["authoring/wall-sconce-rev-a", "blink", "a/b/c-d"]) {
      expect(decodeProjectId(encodeProjectId(rel))).toBe(rel)
    }
  })

  test("rejects invalid ids", () => {
    expect(() => decodeProjectId("not valid base64url!!")).toThrow("Invalid project ID")
  })
})

describe("isInside", () => {
  test("accepts nested paths", () => {
    expect(isInside("/ws", "/ws/a/b")).toBe(true)
    expect(isInside("/ws", "/ws")).toBe(true)
  })

  test("rejects escapes", () => {
    expect(isInside("/ws", "/ws/../etc")).toBe(false)
    expect(isInside("/ws", "/etc")).toBe(false)
    expect(isInside("/ws", "/ws-other")).toBe(false)
  })
})

describe("validateProjectName", () => {
  test("accepts kebab-case names", () => {
    expect(() => validateProjectName("motor-driver-rev-a")).not.toThrow()
    expect(() => validateProjectName("blink2")).not.toThrow()
  })

  test("rejects unsafe names", () => {
    for (const bad of ["", "Bad", "has space", "../escape", "a/b", "-leading", "ütf8"]) {
      expect(() => validateProjectName(bad)).toThrow()
    }
  })
})

describe("catalog state", () => {
  test("distinguishes missing and empty catalogs", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-catalog-state-"))
    try {
      expect(await inspectCatalog(workspaceRoot)).toMatchObject({
        available: false,
        scope: "workspace",
        catalogPath: path.join("catalog", "parts"),
        reason: "catalog_directory_missing",
        parts: [],
        malformedCount: 0,
        skippedCount: 0,
      })

      await mkdir(path.join(workspaceRoot, "catalog", "parts"), { recursive: true })
      expect(await inspectCatalog(workspaceRoot)).toMatchObject({ available: true, reason: "catalog_empty", parts: [] })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  test("reports malformed and skipped catalog files while loading valid parts", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-catalog-files-"))
    try {
      const catalogDir = path.join(workspaceRoot, "catalog", "parts")
      await mkdir(catalogDir, { recursive: true })
      await writeFile(path.join(catalogDir, "valid.yml"), "mpn: TEST-123\nmanufacturer: Example Corp\n")
      await writeFile(path.join(catalogDir, "broken.yml"), "[invalid\n")
      await writeFile(path.join(catalogDir, "README.txt"), "not a part\n")

      const catalog = await inspectCatalog(workspaceRoot)
      expect(catalog).toMatchObject({ available: true, reason: null, malformedCount: 1, skippedCount: 1 })
      expect(catalog.parts).toEqual([expect.objectContaining({ mpn: "TEST-123", manufacturer: "Example Corp" })])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  test("reports no_matches separately from an unavailable catalog", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-catalog-query-"))
    try {
      const catalogDir = path.join(workspaceRoot, "catalog", "parts")
      await mkdir(catalogDir, { recursive: true })
      await writeFile(path.join(catalogDir, "test.yml"), "mpn: TEST-123\n")
      const hooks = await createPcbStudioPlugin()({ directory: workspaceRoot } as any)
      const output = JSON.parse((await hooks.tool?.pcb_catalog_list.execute({ query: "missing" }, {} as any)) as string)
      expect(output).toMatchObject({ available: true, reason: "no_matches", parts: [], total: 0 })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe("component search", () => {
  test("normalizes official tsci search results", () => {
    const result = parseComponentSearchOutput(
      JSON.stringify({
        query: "usb-c",
        results: [
          {
            source: "jlcpcb",
            lcsc: 2913201,
            mfr: "ESP32-S3-WROOM-1-N8R8",
            package: "SMD,25.5x18mm",
            is_basic: false,
            is_preferred: true,
            description: "Wi-Fi module",
            stock: 10880,
            price: 4.715,
          },
          {
            source: "tscircuit",
            name: "seveibar/smd-usb-c",
            latest_version: "0.0.2",
            ai_description: "USB Type-C connector",
            ai_usage_instructions: 'import { SmdUsbC } from "@tsci/seveibar.smd-usb-c"',
            star_count: 2,
            public_dist_enabled: true,
            latest_package_release_id: "release-1",
          },
          {
            source: "kicad",
            path: "Connector_USB.pretty/USB_C_Receptacle_HRO_TYPE-C-31-M-12.kicad_mod",
          },
        ],
      }),
    )

    expect(result).toEqual({
      query: "usb-c",
      results: [
        {
          source: "jlcpcb",
          exactMatch: false,
          lcscPartNumber: "C2913201",
          manufacturerPartNumber: "ESP32-S3-WROOM-1-N8R8",
          packageDescription: "SMD,25.5x18mm",
          description: "Wi-Fi module",
          stock: 10880,
          unitPrice: 4.715,
          isBasic: false,
          isPreferred: true,
          supplierPartNumbers: { jlcpcb: ["C2913201"] },
          loadability: { status: "unknown", reason: "jlcpcb_search_metadata_only" },
        },
        {
          source: "tscircuit",
          exactMatch: false,
          packageName: "seveibar/smd-usb-c",
          version: "0.0.2",
          description: "USB Type-C connector",
          usageInstructions: 'import { SmdUsbC } from "@tsci/seveibar.smd-usb-c"',
          starCount: 2,
          hasPublicDist: true,
          loadability: { status: "loadable", reason: "public_registry_release" },
        },
        {
          source: "kicad",
          exactMatch: false,
          path: "Connector_USB.pretty/USB_C_Receptacle_HRO_TYPE-C-31-M-12.kicad_mod",
          footprint: "kicad:Connector_USB/USB_C_Receptacle_HRO_TYPE-C-31-M-12",
          loadability: { status: "unknown", reason: "kicad_cache_not_checked" },
        },
      ],
    })
  })

  test("rejects malformed search output", () => {
    expect(() => parseComponentSearchOutput('{"query":"BME280"}')).toThrow("query and results array")
    expect(() => parseComponentSearchOutput('{"query":"BME280","results":[{"source":"jlcpcb"}]}')).toThrow("missing required fields")
  })

  test("ranks exact matches before related parts", () => {
    const result = parseComponentSearchOutput(
      JSON.stringify({
        query: "ESP32-S3-WROOM-1-N8R8",
        results: [
          { source: "jlcpcb", lcsc: 2980300, mfr: "ESP32-S3-WROOM-1U-N8R8", package: "SMD,19.2x18mm" },
          { source: "jlcpcb", lcsc: 2913201, mfr: "ESP32-S3-WROOM-1-N8R8", package: "SMD,25.5x18mm" },
        ],
      }),
    )

    expect(result.results.map((entry) => entry.exactMatch)).toEqual([true, false])
    expect(result.results[0]).toMatchObject({ source: "jlcpcb", lcscPartNumber: "C2913201" })
  })

  test("reports non-blocking component loadability evidence", async () => {
    const path = "RF_Module.pretty/ESP32-S3-WROOM-1.kicad_mod"
    expect(kicadFootprint(path)).toBe("kicad:RF_Module/ESP32-S3-WROOM-1")
    expect(kicadCacheUrl(path)).toBe("https://kicad-mod-cache.tscircuit.com/RF_Module.pretty/ESP32-S3-WROOM-1.kicad_mod")
    expect(classifyRegistryLoadability({ public_dist_enabled: true, latest_version: "1.0.0", latest_package_release_id: "r1" })).toEqual({
      status: "loadable",
      reason: "public_registry_release",
    })
    expect(classifyRegistryLoadability({ public_dist_enabled: true })).toMatchObject({ status: "unknown" })

    const hit = await probeKicadLoadability(path, async () => new Response(null, { status: 200 }))
    const miss = await probeKicadLoadability(path, async () => new Response(null, { status: 404 }))
    const indeterminate = await probeKicadLoadability(path, async () => {
      throw new Error("offline")
    })
    expect(hit).toMatchObject({ status: "loadable", reason: "kicad_cache_hit" })
    expect(miss).toMatchObject({ status: "unavailable", reason: "kicad_cache_miss" })
    expect(indeterminate).toMatchObject({ status: "unknown", reason: "kicad_cache_probe_failed" })
  })

  test("serializes npm-backed search work even after failures", async () => {
    const events: string[] = []
    const queued = (name: string, fail = false) =>
      serializeNpmExec(async () => {
        events.push(`${name}:start`)
        await Bun.sleep(5)
        events.push(`${name}:end`)
        if (fail) throw new Error(name)
        return name
      })
    const results = await Promise.allSettled([queued("first", true), queued("second"), queued("third")])
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end", "third:start", "third:end"])
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"])
  })

  test("combines independently searched ecosystems with exact matches first", () => {
    const sourceResult = (scope: "jlcpcb" | "tscircuit" | "kicad", results: any[]) => ({
      success: true,
      processSuccess: true,
      query: "BME280",
      resolvedQuery: "BME280",
      attemptedQueries: ["BME280"],
      fallbackUsed: false,
      scope,
      results,
      stdout: "",
      stderr: "",
      exitCode: 0,
    })
    const combined = combineComponentSearchResults("BME280", [
      sourceResult("jlcpcb", [{ source: "jlcpcb", exactMatch: true, lcscPartNumber: "C92489" }]),
      sourceResult("tscircuit", [{ source: "tscircuit", exactMatch: true, packageName: "nubzzz/BME280" }]),
      sourceResult("kicad", [{ source: "kicad", exactMatch: false, footprint: "kicad:Sensor:BME280" }]),
    ] as any)

    expect(combined).toMatchObject({ success: true, processSuccess: true, scope: "all" })
    expect(combined.results.map((entry) => entry.source)).toEqual(["jlcpcb", "tscircuit", "kicad"])
  })

  test("extracts one focused fallback query", () => {
    expect(componentSearchFallbackQuery("BME280 temperature humidity pressure sensor")).toBe("BME280")
    expect(componentSearchFallbackQuery("SSD1306 0.96 OLED 128x64 I2C")).toBe("SSD1306")
    expect(componentSearchFallbackQuery("BME280")).toBeNull()
    expect(componentSearchFallbackQuery("ambient light sensor")).toBeNull()
  })

  test("rejects empty queries before invoking tsci", async () => {
    await expect(searchComponents("  ")).rejects.toThrow("must not be empty")
  })

  test("registers the component search tool", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-component-search-"))
    try {
      const hooks = await createPcbStudioPlugin()({ directory: workspaceRoot } as any)
      expect(hooks.tool?.pcb_component_search).toBeDefined()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe("Circuit JSON inspection", () => {
  test("reports a valid design with no diagnostics", () => {
    const result = inspectCircuitJson([{ type: "source_component" }, { type: "source_trace" }])
    expect(result).toEqual({ designValid: true, errorCount: 0, warningCount: 0, errors: [], warnings: [] })
  })

  test("groups warning messages without invalidating the design", () => {
    const result = inspectCircuitJson([
      { type: "source_pin_missing_trace_warning", message: "R1 pin1 is missing a trace" },
      { type: "source_pin_missing_trace_warning", message: "R1 pin2 is missing a trace" },
    ])
    expect(result.designValid).toBe(true)
    expect(result.warningCount).toBe(2)
    expect(result.warnings).toEqual([
      {
        type: "source_pin_missing_trace_warning",
        count: 2,
        messages: ["R1 pin1 is missing a trace", "R1 pin2 is missing a trace"],
        omittedCount: 0,
        targets: [],
      },
    ])
  })

  test("invalidates the design and groups every error type", () => {
    const result = inspectCircuitJson([
      { type: "pcb_courtyard_overlap_error", message: "U1 overlaps R1" },
      { type: "pcb_courtyard_overlap_error", message: "U1 overlaps C1" },
      { type: "source_missing_property_error" },
    ])
    expect(result.designValid).toBe(false)
    expect(result.errorCount).toBe(3)
    expect(result.errors).toEqual([
      {
        type: "pcb_courtyard_overlap_error",
        count: 2,
        messages: ["U1 overlaps R1", "U1 overlaps C1"],
        omittedCount: 0,
        targets: [],
      },
      { type: "source_missing_property_error", count: 1, messages: [], omittedCount: 0, targets: [] },
    ])
  })

  test("bounds warning samples and reports omitted messages", () => {
    const result = inspectCircuitJson(
      Array.from({ length: 5 }, (_, index) => ({ type: "source_pin_missing_trace_warning", message: `warning ${index + 1}` })),
    )
    expect(result.warnings[0]).toEqual({
      type: "source_pin_missing_trace_warning",
      count: 5,
      messages: ["warning 1", "warning 2", "warning 3"],
      omittedCount: 2,
      targets: [],
    })
  })

  test("resolves overlap components and trace endpoints", () => {
    const result = inspectCircuitJson([
      { type: "source_component", source_component_id: "source_u1", name: "U1" },
      { type: "source_component", source_component_id: "source_r1", name: "R1" },
      { type: "source_port", source_port_id: "source_port_1", source_component_id: "source_u1", name: "GPIO1" },
      {
        type: "pcb_component",
        pcb_component_id: "pcb_u1",
        source_component_id: "source_u1",
        center: { x: -8, y: 17 },
        width: 6,
        height: 6,
        rotation: 90,
        layer: "top",
      },
      {
        type: "pcb_component",
        pcb_component_id: "pcb_r1",
        source_component_id: "source_r1",
        center: { x: -3, y: 17 },
        width: 2,
        height: 1,
        rotation: 0,
        layer: "top",
      },
      {
        type: "pcb_port",
        pcb_port_id: "pcb_port_1",
        source_port_id: "source_port_1",
        pcb_component_id: "pcb_u1",
        x: -7,
        y: 17,
        layers: ["top"],
      },
      {
        type: "pcb_courtyard_overlap_error",
        message: "U1 overlaps R1",
        pcb_component_ids: ["pcb_u1", "pcb_r1"],
      },
      {
        type: "pcb_trace_error",
        message: "Trace is incomplete",
        source_trace_id: "source_trace_1",
        pcb_trace_id: "pcb_trace_1",
        pcb_component_ids: ["pcb_u1"],
        pcb_port_ids: ["pcb_port_1"],
        center: { x: -6, y: 17 },
      },
    ])

    expect(result.errors[0].targets).toEqual([
      {
        kind: "component",
        refdes: "U1",
        center: [-8, 17],
        width: 6,
        height: 6,
        rotation: 90,
        layer: "top",
        sourceComponentId: "source_u1",
        pcbComponentId: "pcb_u1",
      },
      {
        kind: "component",
        refdes: "R1",
        center: [-3, 17],
        width: 2,
        height: 1,
        rotation: 0,
        layer: "top",
        sourceComponentId: "source_r1",
        pcbComponentId: "pcb_r1",
      },
    ])
    expect(result.errors[1].targets).toEqual([
      expect.objectContaining({ kind: "component", refdes: "U1", pcbComponentId: "pcb_u1" }),
      expect.objectContaining({
        kind: "port",
        refdes: "U1",
        portName: "GPIO1",
        center: [-7, 17],
        sourcePortId: "source_port_1",
        pcbPortId: "pcb_port_1",
      }),
      expect.objectContaining({
        kind: "trace",
        center: [-6, 17],
        sourceTraceId: "source_trace_1",
        pcbTraceId: "pcb_trace_1",
      }),
    ])
  })

  test("rejects non-array documents", () => {
    expect(() => parseCircuitJson({ elements: [] })).toThrow("Circuit JSON must be an array")
    expect(() => parseCircuitJson([null])).toThrow("Circuit JSON element at index 0 must be an object")
  })

  test("reports only deterministic manufacturing blockers", () => {
    expect(
      manufacturingBlockers([
        { type: "pcb_trace_error", message: "Trace is incomplete" },
        { type: "pcb_note_text", text: "PCB_STUDIO_PLACEHOLDER: U1 - exact footprint required" },
        { type: "source_pin_missing_trace_warning", message: "Port CC1 on USB1 is missing a trace" },
        { type: "supplier_footprint_mismatch_warning", message: "U1 footprint does not match C123" },
        { type: "source_unnamed_trace_warning", message: "Trace is missing a name" },
      ]),
    ).toEqual([
      { type: "invalid_design", count: 1, messages: ["Trace is incomplete"] },
      {
        type: "placeholder_component",
        count: 1,
        messages: ["PCB_STUDIO_PLACEHOLDER: U1 - exact footprint required"],
      },
      { type: "supplier_footprint_mismatch", count: 1, messages: ["U1 footprint does not match C123"] },
      { type: "unconnected_pin", count: 1, messages: ["Port CC1 on USB1 is missing a trace"] },
    ])
  })

  test("blocks chips whose supplier identity cannot be verified", () => {
    expect(
      manufacturingBlockers([
        {
          type: "source_component",
          ftype: "simple_chip",
          name: "U1",
          manufacturer_part_number: "ESP32-S3-WROOM-1-N8R8",
          supplier_part_numbers: { jlcpcb: [] },
        },
        { type: "source_component_pins_underspecified_warning", message: "All pins on U1 are underspecified" },
      ]),
    ).toEqual([
      {
        type: "unverified_part",
        count: 1,
        messages: ["U1 (ESP32-S3-WROOM-1-N8R8) has no verifiable supplier part number"],
      },
    ])
  })
})

describe("Circuit JSON querying", () => {
  const elements = [
    { type: "source_component", name: "R1" },
    { type: "source_trace", name: "T1" },
    { type: "source_component", name: "C1" },
  ]

  test("lists element types with counts", () => {
    expect(elementTypeCounts(elements)).toEqual([
      { type: "source_component", count: 2 },
      { type: "source_trace", count: 1 },
    ])
  })

  test("filters and paginates exact element types", () => {
    expect(selectCircuitElements(elements, { types: ["source_component"], offset: 1, limit: 1 })).toEqual({
      elements: [{ type: "source_component", name: "C1" }],
      total: 2,
      returned: 1,
      hasMore: false,
    })
  })

  test("returns an empty page for unknown types", () => {
    expect(selectCircuitElements(elements, { types: ["missing"], offset: 0, limit: 10 })).toEqual({
      elements: [],
      total: 0,
      returned: 0,
      hasMore: false,
    })
  })

  test("returns an overview without elements by default", () => {
    const result = queryCircuitJson(elements)
    expect(result.summary).toEqual({ totalElements: 3, components: 2, nets: 0, traces: 1 })
    expect(result.elementTypes).toEqual(elementTypeCounts(elements))
    expect(result).not.toHaveProperty("selection")
    expect(result).not.toHaveProperty("circuitJson")
  })

  test("includes the complete document only when requested", () => {
    expect(queryCircuitJson(elements, { includeFullJson: true }).circuitJson).toEqual(elements)
  })
})

describe("build validation", () => {
  test("fails a successful process when Circuit JSON contains an error", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-build-"))
    try {
      const outputDir = path.join(projectDir, "dist", "src", "circuit")
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(projectDir, "package.json"), JSON.stringify({ scripts: { "build:source": "node build.cjs" } }))
      await writeFile(
        path.join(projectDir, "build.cjs"),
        `require("node:fs").writeFileSync("dist/src/circuit/circuit.json", ${JSON.stringify(
          JSON.stringify([{ type: "pcb_courtyard_overlap_error", message: "U1 overlaps R1" }]),
        )})\n`,
      )

      const result = await runProjectBuild(projectDir)
      expect(result.processSuccess).toBe(true)
      expect(result.success).toBe(false)
      expect(result.inspection?.designValid).toBe(false)
      expect(result.inspection?.errorCount).toBe(1)
      expect(result.artifacts.circuitJsonPath).toBe(path.join(outputDir, "circuit.json"))
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("removes stale artifacts before a failed rebuild", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-stale-build-"))
    try {
      const outputDir = path.join(projectDir, "dist", "src", "circuit")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(path.join(projectDir, "package.json"), JSON.stringify({ scripts: { "build:source": 'node -e "process.exit(1)"' } }))
      await writeFile(path.join(outputDir, "circuit.json"), "[]")
      await writeFile(path.join(projectDir, "dist", "circuit-gerbers.zip"), "stale")

      const result = await runProjectBuild(projectDir)
      expect(result.success).toBe(false)
      expect(result.processSuccess).toBe(false)
      await expect(exportCircuit(projectDir, ["gerber"])).rejects.toThrow()
      expect(await Bun.file(path.join(outputDir, "circuit.json")).exists()).toBe(false)
      expect(await Bun.file(path.join(projectDir, "dist", "circuit-gerbers.zip")).exists()).toBe(false)
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("blocks Gerber generation for an invalid design", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-invalid-export-"))
    try {
      const outputDir = path.join(projectDir, "dist", "src", "circuit")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(path.join(outputDir, "circuit.json"), JSON.stringify([{ type: "pcb_trace_error", message: "Trace is incomplete" }]))

      const result = await exportCircuit(projectDir, ["gerber"])
      expect(result.success).toBe(false)
      expect(result.artifactGenerationSucceeded).toBe(false)
      expect(result.designValid).toBe(false)
      expect(result.debugOnly).toBe(false)
      expect(result.blockedFormats).toEqual(["gerber"])
      expect(result.generatedFormats).toEqual([])
      expect(result.manufacturingBlockers).toEqual([{ type: "invalid_design", count: 1, messages: ["Trace is incomplete"] }])
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("blocks Gerber generation and removes stale output for a placeholder", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-placeholder-export-"))
    try {
      const outputDir = path.join(projectDir, "dist", "src", "circuit")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(outputDir, "circuit.json"),
        JSON.stringify([{ type: "pcb_note_text", text: "PCB_STUDIO_PLACEHOLDER: U1 - exact footprint required" }]),
      )
      const staleGerberPath = path.join(projectDir, "dist", "circuit-gerbers.zip")
      await writeFile(staleGerberPath, "stale")

      const result = await exportCircuit(projectDir, ["gerber"])
      expect(result).toMatchObject({
        success: false,
        artifactGenerationSucceeded: false,
        designValid: true,
        debugOnly: false,
        blockedFormats: ["gerber"],
        generatedFormats: [],
        manufacturingBlockers: [{ type: "placeholder_component", count: 1 }],
      })
      expect(await Bun.file(staleGerberPath).exists()).toBe(false)
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("blocks Gerber generation for a supplier footprint mismatch", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-mismatch-export-"))
    try {
      const outputDir = path.join(projectDir, "dist", "src", "circuit")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(outputDir, "circuit.json"),
        JSON.stringify([{ type: "supplier_footprint_mismatch_warning", message: "U1 footprint does not match C123" }]),
      )

      const result = await exportCircuit(projectDir, ["gerber"])
      expect(result).toMatchObject({
        success: false,
        artifactGenerationSucceeded: false,
        designValid: true,
        blockedFormats: ["gerber"],
        generatedFormats: [],
        manufacturingBlockers: [{ type: "supplier_footprint_mismatch", count: 1 }],
      })
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("blocks Gerber when a chip drops its supplier identity to hide a generic footprint", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-unverified-export-"))
    try {
      const outputDir = path.join(projectDir, "dist", "src", "circuit")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(outputDir, "circuit.json"),
        JSON.stringify([
          {
            type: "source_component",
            ftype: "simple_chip",
            name: "U1",
            manufacturer_part_number: "ESP32-S3-WROOM-1-N8R8",
            supplier_part_numbers: { jlcpcb: [] },
          },
          { type: "source_component_pins_underspecified_warning", message: "All pins on U1 are underspecified" },
        ]),
      )

      const result = await exportCircuit(projectDir, ["gerber"])
      expect(result).toMatchObject({
        success: false,
        artifactGenerationSucceeded: false,
        designValid: true,
        blockedFormats: ["gerber"],
        generatedFormats: [],
        manufacturingBlockers: [{ type: "unverified_part", count: 1 }],
      })
    } finally {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  test("blocks CPL generation for invalid designs and unconnected pins", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-invalid-cpl-"))
    try {
      const projectDir = path.join(workspaceRoot, "invalid-board")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          { type: "source_component", source_component_id: "s1", name: "R1" },
          { type: "pcb_component", source_component_id: "s1", center: { x: 0, y: 0 }, layer: "top" },
          { type: "pcb_trace_error", message: "Trace is incomplete" },
        ]),
      )
      const hooks = await createPcbStudioPlugin()({ directory: workspaceRoot } as any)
      const projectId = encodeProjectId("invalid-board")

      const blocked = JSON.parse((await hooks.tool?.pcb_assembly_export.execute({ projectId }, {} as any)) as string)
      expect(blocked).toMatchObject({
        success: false,
        artifactGenerationSucceeded: false,
        designValid: false,
        debugOnly: false,
        reason: "invalid_design",
        manufacturingBlockers: [{ type: "invalid_design", count: 1 }],
      })
      expect(blocked).not.toHaveProperty("csv")

      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          { type: "source_component", source_component_id: "s1", name: "R1" },
          { type: "pcb_component", source_component_id: "s1", center: { x: 0, y: 0 }, layer: "top" },
          { type: "source_pin_missing_trace_warning", message: "Port pin1 on R1 is missing a trace" },
        ]),
      )
      const unconnected = JSON.parse((await hooks.tool?.pcb_assembly_export.execute({ projectId }, {} as any)) as string)
      expect(unconnected).toMatchObject({
        success: false,
        artifactGenerationSucceeded: false,
        designValid: true,
        reason: "unconnected_pin",
        manufacturingBlockers: [{ type: "unconnected_pin", count: 1 }],
      })

      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          { type: "source_component", source_component_id: "s1", name: "R1" },
          { type: "pcb_component", source_component_id: "s1", center: { x: 0, y: 0 }, layer: "top" },
          { type: "supplier_footprint_mismatch_warning", message: "R1 footprint does not match C123" },
        ]),
      )
      const mismatch = JSON.parse((await hooks.tool?.pcb_assembly_export.execute({ projectId }, {} as any)) as string)
      expect(mismatch).toMatchObject({
        success: false,
        artifactGenerationSucceeded: false,
        designValid: true,
        reason: "supplier_footprint_mismatch",
        manufacturingBlockers: [{ type: "supplier_footprint_mismatch", count: 1 }],
      })
      expect(unconnected).not.toHaveProperty("csv")

      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          { type: "source_component", source_component_id: "s1", name: "R1" },
          { type: "pcb_component", source_component_id: "s1", center: { x: 0, y: 0 }, layer: "top" },
        ]),
      )
      const incompleteBom = JSON.parse((await hooks.tool?.pcb_assembly_export.execute({ projectId }, {} as any)) as string)
      expect(incompleteBom).toMatchObject({
        success: false,
        fabricationReady: true,
        assemblyReady: false,
        reason: "bom_incomplete",
        manufacturingBlockers: [],
        assemblyBlockers: [{ type: "bom_incomplete", count: 1 }],
      })
      expect(incompleteBom).not.toHaveProperty("csv")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe("companion project diagnostics", () => {
  test("exposes health counts in lists and full diagnostics in project details", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-api-"))
    try {
      const projectDir = path.join(workspaceRoot, "invalid-board")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          { type: "pcb_courtyard_overlap_error", message: "U1 overlaps R1" },
          { type: "source_pin_missing_trace_warning", message: "R1 pin1 is missing a trace" },
        ]),
      )

      const app = testApp(workspaceRoot)
      const list = (await (await api(app, "/api/projects")).json()) as any
      expect(list.projects[0]).toMatchObject({
        designValid: false,
        fabricationReady: false,
        assemblyReady: false,
        errorCount: 1,
        warningCount: 1,
      })
      expect(list.projects[0]).not.toHaveProperty("diagnostics")

      const id = encodeProjectId("invalid-board")
      const detail = (await (await api(app, `/api/projects/${id}`)).json()) as any
      expect(detail.diagnostics.errors[0]).toEqual({
        type: "pcb_courtyard_overlap_error",
        count: 1,
        messages: ["U1 overlaps R1"],
        omittedCount: 0,
        targets: [],
      })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe("companion OSC host security", () => {
  test("rejects unexpected Host headers and exposes identity plus security headers", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-security-"))
    try {
      const app = testApp(workspaceRoot)
      const rejected = await app.request("/api/health", { headers: { Host: "evil.example" } })
      expect(rejected.status).toBe(400)

      const health = await api(app, "/api/health")
      expect(health.status).toBe(200)
      expect(health.headers.get("x-content-type-options")).toBe("nosniff")
      const csp = health.headers.get("content-security-policy") ?? ""
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("wasm-unsafe-eval")
      expect(csp).toContain("https://kicad-mod-cache.tscircuit.com")

      const studio = (await (await api(app, "/api/studio")).json()) as {
        id: string
        packageVersion: string
        contractVersion: string
      }
      expect(studio).toMatchObject({ id: "pcb", contractVersion: "1.0.0" })
      expect(studio.packageVersion).toBeTruthy()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe("3D model selection", () => {
  test("prefers working STEP models over unavailable KiCad cache WRL models", () => {
    const stepUrl = "https://kicad-mod-cache.tscircuit.com/Resistor_SMD/R_0402_1005Metric.step"
    const result = preferKicadStepModels([
      {
        type: "cad_component",
        model_step_url: stepUrl,
        model_wrl_url: "https://kicad-mod-cache.tscircuit.com/Resistor_SMD/R_0402_1005Metric.wrl",
      },
      { type: "cad_component", model_step_url: "https://example.com/model.step", model_wrl_url: "https://example.com/model.wrl" },
    ]) as Record<string, unknown>[]

    expect(result[0]).toEqual({ type: "cad_component", model_step_url: stepUrl })
    expect(result[1]).toHaveProperty("model_wrl_url", "https://example.com/model.wrl")
  })

  test("reports missing and unreachable models per component", async () => {
    const availableUrl = "https://models.example/available.step"
    const missingUrl = "https://models.example/missing.step"
    const circuitJson = [
      { type: "source_component", source_component_id: "source_1", name: "U1" },
      { type: "source_component", source_component_id: "source_2", name: "J1" },
      { type: "source_component", source_component_id: "source_3", name: "U2" },
      { type: "cad_component", source_component_id: "source_1", model_step_url: availableUrl },
      { type: "cad_component", source_component_id: "source_2", model_step_url: missingUrl },
      { type: "cad_component", source_component_id: "source_3" },
    ]
    const fetchModel = (async (url: string) => new Response(null, { status: url === availableUrl ? 200 : 404 })) as typeof fetch

    expect(await checkCadAssetHealth(circuitJson, fetchModel)).toEqual({
      status: "partial",
      total: 3,
      available: 1,
      missing: 2,
      issues: [
        { component: "J1", reason: "unreachable", url: missingUrl },
        { component: "U2", reason: "no-model" },
      ],
    })
  })
})

describe("BOM generation", () => {
  test("groups components by MPN", () => {
    const bom = generateBom([
      { type: "source_component", name: "R1", manufacturer_part_number: "RC0402FR-0710KL" },
      { type: "source_component", name: "R2", manufacturer_part_number: "RC0402FR-0710KL" },
      { type: "source_component", name: "C1", manufacturer_part_number: "CL10A106KQ8NNNC" },
    ])
    expect(bom.entries).toHaveLength(2)
    expect(bom.entries[0]).toMatchObject({ mpn: "CL10A106KQ8NNNC", refdes: ["C1"], quantity: 1 })
    expect(bom.entries[1]).toMatchObject({ mpn: "RC0402FR-0710KL", refdes: ["R1", "R2"], quantity: 2 })
  })

  test("lists components without MPN separately", () => {
    const bom = generateBom([
      { type: "source_component", name: "U1", manufacturer_part_number: "ATMEGA328P" },
      { type: "source_component", name: "R1" },
      { type: "source_component", name: "C1" },
    ])
    const listed = bom.entries.find((e) => e.mpn === "ATMEGA328P")
    expect(listed).toBeDefined()
    expect(listed!.refdes).toEqual(["U1"])
    const unlisted = bom.entries.find((e) => e.mpn === null)
    expect(unlisted).toBeDefined()
    expect(unlisted!.refdes).toEqual(["C1", "R1"])
    expect(unlisted!.quantity).toBe(2)
  })

  test("includes supplier part numbers without treating them as MPNs", () => {
    const bom = generateBom([
      { type: "source_component", name: "R1", supplier_part_numbers: { jlcpcb: ["C25804", "C25744"] } },
      { type: "source_component", name: "R2", supplier_part_numbers: { jlcpcb: ["C25744", "C25804"] } },
      {
        type: "source_component",
        name: "U1",
        manufacturer_part_number: "ESP32-S3-WROOM-1-N8R8",
        supplier_part_numbers: { jlcpcb: ["C2913201"] },
      },
      { type: "source_component", name: "J1" },
    ])

    expect(bom.entries).toContainEqual(
      expect.objectContaining({ mpn: null, supplierPartNumbers: { jlcpcb: ["C25744", "C25804"] }, refdes: ["R1", "R2"] }),
    )
    expect(bom.entries).toContainEqual(
      expect.objectContaining({
        mpn: "ESP32-S3-WROOM-1-N8R8",
        supplierPartNumbers: { jlcpcb: ["C2913201"] },
        refdes: ["U1"],
      }),
    )
    expect(bom.componentsWithMpn).toBe(1)
    expect(bom.componentsWithoutMpn).toBe(3)
    expect(bom.componentsWithSupplierPartNumbers).toBe(3)
    expect(bom.componentsWithoutPartNumbers).toBe(1)
    expect(bom.bomComplete).toBe(false)
  })

  test("cross-references catalog parts metadata", () => {
    const bom = generateBom(
      [
        { type: "source_component", name: "U1", manufacturer_part_number: "ESP32-S3-WROOM-1-N8R8" },
        { type: "source_component", name: "R1", manufacturer_part_number: "UNKNOWN-PART" },
      ],
      [
        {
          mpn: "ESP32-S3-WROOM-1-N8R8",
          manufacturer: "Espressif Systems",
          description: "ESP32-S3 module",
          datasheet: "https://example.com/ds.pdf",
          category: "mcu-module",
        },
      ],
    )
    const esp = bom.entries.find((e) => e.mpn === "ESP32-S3-WROOM-1-N8R8")
    expect(esp?.manufacturer).toBe("Espressif Systems")
    expect(esp?.description).toBe("ESP32-S3 module")
    expect(esp?.datasheet).toBe("https://example.com/ds.pdf")
    expect(esp?.category).toBe("mcu-module")

    const unknown = bom.entries.find((e) => e.mpn === "UNKNOWN-PART")
    expect(unknown?.manufacturer).toBeNull()
  })

  test("ignores non-component elements", () => {
    const bom = generateBom([
      { type: "source_component", name: "R1", manufacturer_part_number: "RC0402FR-0710KL" },
      { type: "source_trace", name: "T1" },
      { type: "source_net", name: "VCC" },
    ])
    expect(bom.totalComponents).toBe(1)
    expect(bom.componentsWithMpn).toBe(1)
    expect(bom.componentsWithoutMpn).toBe(0)
    expect(bom.bomComplete).toBe(true)
    expect(bom.entries).toHaveLength(1)
    expect(bom.entries[0].refdes).toEqual(["R1"])
  })

  test("handles empty circuit JSON", () => {
    const bom = generateBom([])
    expect(bom.entries).toHaveLength(0)
    expect(bom.totalComponents).toBe(0)
    expect(bom.bomComplete).toBe(true)
    expect(bom.listedCount).toBe(0)
    expect(bom.unlistedCount).toBe(0)
  })

  test("exposes BOM via server API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-bom-api-"))
    try {
      const projectDir = path.join(workspaceRoot, "test-board")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          { type: "source_component", name: "R1", manufacturer_part_number: "RC0402FR-0710KL" },
          { type: "source_component", name: "R2", manufacturer_part_number: "RC0402FR-0710KL" },
          { type: "source_component", name: "U1", manufacturer_part_number: "ESP32-S3-WROOM-1-N8R8" },
        ]),
      )

      const app = testApp(workspaceRoot)
      const id = encodeProjectId("test-board")
      const res = await api(app, `/api/projects/${id}/bom`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.entries).toHaveLength(2)
      expect(body.totalComponents).toBe(3)
      expect(body.listedCount).toBe(2)
      expect(body.unlistedCount).toBe(0)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  test("generates BOM CSV with header and rows", () => {
    const csv = toBomCsv([
      {
        mpn: "RC0402FR-0710KL",
        supplierPartNumbers: { jlcpcb: ["C25804"] },
        refdes: ["R1", "R2"],
        quantity: 2,
        manufacturer: "Yageo",
        description: "10k resistor",
        datasheet: null,
        category: "resistor",
      },
      {
        mpn: null,
        supplierPartNumbers: {},
        refdes: ["C1", "C2"],
        quantity: 2,
        manufacturer: null,
        description: null,
        datasheet: null,
        category: null,
      },
    ])
    const lines = csv.trim().split("\n")
    expect(lines[0]).toBe("MPN,Supplier Part Numbers,Refdes,Quantity,Manufacturer,Description,Datasheet,Category")
    expect(lines[1]).toBe("RC0402FR-0710KL,jlcpcb:C25804,R1; R2,2,Yageo,10k resistor,,resistor")
    expect(lines[2]).toBe(",,C1; C2,2,,,,")
  })

  test("exposes BOM CSV via server API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-bom-csv-api-"))
    try {
      const projectDir = path.join(workspaceRoot, "test-board")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([{ type: "source_component", name: "R1", manufacturer_part_number: "RC0402FR-0710KL" }]),
      )

      const app = testApp(workspaceRoot)
      const id = encodeProjectId("test-board")
      const res = await api(app, `/api/projects/${id}/bom.csv`)
      expect(res.status).toBe(200)
      const csv = await res.text()
      expect(csv).toContain("MPN,Supplier Part Numbers,Refdes,Quantity")
      expect(csv).toContain("RC0402FR-0710KL")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe("Pick & Place generation", () => {
  test("generates CPL entries from pcb_component and source_component", () => {
    const result = generatePickAndPlace([
      { type: "source_component", source_component_id: "s1", name: "R1" },
      { type: "source_component", source_component_id: "s2", name: "U1" },
      {
        type: "pcb_component",
        source_component_id: "s1",
        center: { x: 10, y: 20 },
        layer: "top",
        rotation: 0,
      },
      {
        type: "pcb_component",
        source_component_id: "s2",
        center: { x: -5, y: 15 },
        layer: "bottom",
        rotation: 90,
      },
    ])
    expect(result.entries).toHaveLength(2)
    expect(result.skipped).toBe(0)
    expect(result.entries[0]).toEqual({ designator: "R1", midX: 10, midY: 20, layer: "Top", rotation: 0, mpn: null })
    expect(result.entries[1]).toEqual({ designator: "U1", midX: -5, midY: 15, layer: "Bottom", rotation: 90, mpn: null })
  })

  test("skips do_not_place components", () => {
    const result = generatePickAndPlace([
      { type: "source_component", source_component_id: "s1", name: "R1" },
      {
        type: "pcb_component",
        source_component_id: "s1",
        center: { x: 0, y: 0 },
        layer: "top",
        rotation: 0,
        do_not_place: true,
      },
    ])
    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  test("includes MPN from source_component", () => {
    const result = generatePickAndPlace([
      { type: "source_component", source_component_id: "s1", name: "R1", manufacturer_part_number: "RC0402FR-0710KL" },
      {
        type: "pcb_component",
        source_component_id: "s1",
        center: { x: 5, y: 5 },
        layer: "top",
        rotation: 0,
      },
    ])
    expect(result.entries[0].mpn).toBe("RC0402FR-0710KL")
  })

  test("generates CPL CSV with header and rows", () => {
    const csv = toCplCsv([
      { designator: "R1", midX: 10, midY: 20, layer: "Top", rotation: 0, mpn: "RC0402FR-0710KL" },
      { designator: "C1", midX: -3, midY: 8, layer: "Bottom", rotation: 180, mpn: null },
    ])
    const lines = csv.trim().split("\n")
    expect(lines[0]).toBe("Designator,Mid X,Mid Y,Rotation,Layer")
    expect(lines[1]).toBe("R1,10,20,0,Top")
    expect(lines[2]).toBe("C1,-3,8,180,Bottom")
  })

  test("handles empty Circuit JSON", () => {
    const result = generatePickAndPlace([])
    expect(result.entries).toHaveLength(0)
    expect(result.totalComponents).toBe(0)
    expect(result.skipped).toBe(0)
  })

  test("exposes assembly CSV via server API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-studio-asm-api-"))
    try {
      const projectDir = path.join(workspaceRoot, "asm-board")
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          { type: "source_component", source_component_id: "s1", name: "R1" },
          {
            type: "pcb_component",
            source_component_id: "s1",
            center: { x: 10, y: 20 },
            layer: "top",
            rotation: 0,
          },
        ]),
      )

      const app = testApp(workspaceRoot)
      const id = encodeProjectId("asm-board")
      const blocked = await api(app, `/api/projects/${id}/assembly.csv`)
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toMatchObject({
        error: "Assembly export blocked",
        fabricationReady: true,
        assemblyReady: false,
        assemblyBlockers: [{ type: "bom_incomplete", count: 1 }],
      })

      await writeFile(
        path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
        JSON.stringify([
          {
            type: "source_component",
            source_component_id: "s1",
            name: "R1",
            manufacturer_part_number: "RC0402FR-0710KL",
          },
          {
            type: "pcb_component",
            source_component_id: "s1",
            center: { x: 10, y: 20 },
            layer: "top",
            rotation: 0,
          },
        ]),
      )
      const res = await api(app, `/api/projects/${id}/assembly.csv`)
      expect(res.status).toBe(200)
      const csv = await res.text()
      expect(csv).toContain("Designator")
      expect(csv).toContain("R1,10,20,0,Top")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
