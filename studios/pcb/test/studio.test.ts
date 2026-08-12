import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import packageManifest from "../../../package.json" with { type: "json" }
import { isInside } from "../../../src/core/paths"
import { createPcbApi } from "../api"
import { buildInputDigest, writeBuildInputStamp } from "../artifact-freshness"
import { generatePickAndPlace, toCplCsv } from "../assembly"
import { generateBom } from "../bom"
import { getCatalogPart, inspectCatalog, spiceModelSnippet, upsertCatalogPart, validateSpiceModel } from "../catalog"
import { manufacturingBlockers } from "../circuit-json"
import { basicProjectTemplate, TSCIRCUIT_VERSION } from "../templates"
import { createPcbStudioPlugin } from "../tools"
import {
  exportCircuit,
  extractAnalogSimulationDiagnostics,
  extractAnalogSimulationExperiments,
  runProjectBuild,
} from "../tsci"
import { decodeProjectId, discoverProjects, encodeProjectId } from "../workspace"

const temps: string[] = []
async function stampProject(projectDir: string) {
  await writeBuildInputStamp(projectDir, await buildInputDigest(projectDir))
}

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("pcb studio smoke", () => {
  test("scaffold and bundled tscircuit versions stay aligned", () => {
    expect(TSCIRCUIT_VERSION).toBe(packageManifest.dependencies.tscircuit)
    const scaffoldManifest = JSON.parse(basicProjectTemplate("demo-board")["package.json"]!)
    expect(scaffoldManifest.dependencies.tscircuit).toBe(TSCIRCUIT_VERSION)
  })

  test("registers core tools scoped to the OpenCode directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-smoke-"))
    temps.push(workspaceRoot)
    const hooks = await createPcbStudioPlugin()({ directory: workspaceRoot } as any)
    const names = Object.keys(hooks.tool ?? {})
    expect(names).toContain("pcb_workspace_list")
    expect(names).toContain("pcb_catalog_list")
    expect(names).toContain("pcb_catalog_upsert")
    expect(names).toContain("pcb_sim_run")
    expect(names).toContain("pcb_spice_model_get")
    expect(names).toContain("pcb_spice_model_upsert")
    const listed = JSON.parse((await hooks.tool?.pcb_workspace_list.execute({}, {} as any)) as string)
    expect(listed.workspaceRoot).toBe(workspaceRoot)
  })

  test("extracts named probe graphs and preserves endpoints when output is budgeted", () => {
    const experiments = extractAnalogSimulationExperiments(
      [
        { type: "simulation_experiment", simulation_experiment_id: "sim1", name: "load_step" },
        {
          type: "simulation_transient_voltage_graph",
          simulation_experiment_id: "sim1",
          name: "VOUT",
          timestamps_ms: [0, 1, 2, 3, 4],
          voltage_levels: [1, 2, 3, 4, 5],
        },
        {
          type: "simulation_transient_current_graph",
          simulation_experiment_id: "sim1",
          name: "ILOAD",
          timestamps_ms: [0, 1, 2, 3, 4],
          current_levels: [0.1, 0.2, 0.3, 0.4, 0.5],
        },
      ],
      3,
    )
    expect(experiments).toEqual([
      {
        id: "sim1",
        name: "load_step",
        analysis: "transient",
        pointsCount: 5,
        returnedPoints: 3,
        downsampled: true,
        axis: { name: "time", unit: "ms", values: [0, 2, 4] },
        series: [
          {
            name: "VOUT",
            kind: "voltage",
            unit: "V",
            values: [1, 3, 5],
            summary: { first: 1, last: 5, min: 1, max: 5, mean: 3, peakToPeak: 4 },
          },
          {
            name: "ILOAD",
            kind: "current",
            unit: "A",
            values: [0.1, 0.3, 0.5],
            summary: { first: 0.1, last: 0.5, min: 0.1, max: 0.5, mean: 0.3, peakToPeak: 0.4 },
          },
        ],
      },
    ])
  })

  test("project ids roundtrip and path jail holds", () => {
    expect(decodeProjectId(encodeProjectId("nested/demo-board"))).toBe("nested/demo-board")
    expect(isInside("/ws", "/ws/a")).toBe(true)
    expect(isInside("/ws", "/ws/../etc")).toBe(false)
    expect(isInside("/ws", "/ws-other")).toBe(false)
  })

  test("does not follow project symlinks outside the workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-ws-"))
    const outside = await mkdtemp(path.join(os.tmpdir(), "pcb-out-"))
    temps.push(workspace, outside)
    await mkdir(path.join(workspace, "real-proj", "src"), { recursive: true })
    await writeFile(path.join(workspace, "real-proj", "src", "circuit.tsx"), "export default () => null")
    await mkdir(path.join(outside, "secret-proj", "src"), { recursive: true })
    await writeFile(path.join(outside, "secret-proj", "src", "circuit.tsx"), "export default () => null")
    await symlink(outside, path.join(workspace, "link"))
    const names = (await discoverProjects(workspace)).map((p) => p.name)
    expect(names).toContain("real-proj")
    expect(names).not.toContain("secret-proj")
  })

  test("manufacturing blockers gate Gerber export", async () => {
    expect(
      manufacturingBlockers([
        { type: "pcb_trace_error", message: "Trace is incomplete" },
        { type: "pcb_note_text", text: "PCB_STUDIO_PLACEHOLDER: U1 - exact footprint required" },
        {
          type: "source_component",
          ftype: "simple_chip",
          name: "U1",
          manufacturer_part_number: "ESP32-S3",
          supplier_part_numbers: { jlcpcb: [] },
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "invalid_design" }),
        expect.objectContaining({ type: "placeholder_component" }),
        expect.objectContaining({ type: "unverified_part" }),
      ]),
    )

    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-export-"))
    temps.push(projectDir)
    const outputDir = path.join(projectDir, "dist", "src", "circuit")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
    await writeFile(path.join(outputDir, "circuit.json"), JSON.stringify([{ type: "pcb_trace_error", message: "Trace is incomplete" }]))
    await stampProject(projectDir)
    const result = await exportCircuit(projectDir, ["gerber"])
    expect(result.success).toBe(false)
    expect(result.blockedFormats).toEqual(["gerber"])
  })

  test("complex parts require a trimmed supplier identity even when MPN is blank", () => {
    const blockers = manufacturingBlockers([
      { type: "source_component", ftype: "simple_chip", name: "U1" },
      {
        type: "source_component",
        ftype: "complex",
        name: "U2",
        manufacturer_part_number: "   ",
        supplier_part_numbers: { "  ": ["C123"], jlcpcb: ["   "] },
      },
      {
        type: "source_component",
        ftype: "simple_chip",
        name: "U3",
        manufacturer_part_number: " ",
        supplier_part_numbers: { jlcpcb: [" C456 "] },
      },
    ])
    expect(blockers.find((blocker) => blocker.type === "unverified_part")).toEqual(
      expect.objectContaining({
        count: 2,
        messages: expect.arrayContaining([expect.stringContaining("U1"), expect.stringContaining("U2")]),
      }),
    )
  })

  test("BOM groups by MPN", () => {
    const bom = generateBom([
      { type: "source_component", name: "R1", manufacturer_part_number: "RES-10K" },
      { type: "source_component", name: "R2", manufacturer_part_number: "RES-10K" },
      { type: "source_component", name: "C1" },
    ])
    expect(bom.entries).toEqual(expect.arrayContaining([expect.objectContaining({ mpn: "RES-10K", quantity: 2 })]))
  })

  test("CPL CSV includes MPN column", () => {
    const result = generatePickAndPlace([
      {
        type: "source_component",
        source_component_id: "sc1",
        name: "R1",
        manufacturer_part_number: "RES-10K",
      },
      {
        type: "pcb_component",
        source_component_id: "sc1",
        center: { x: 1.5, y: -2 },
        layer: "top",
        rotation: 90,
      },
    ])
    const csv = toCplCsv(result.entries)
    expect(csv.split("\n")[0]).toBe("Designator,Mid X,Mid Y,Rotation,Layer,MPN")
    expect(csv).toContain("R1,1.5,-2,90,Top,RES-10K")
    expect(result.assemblyReady).toBe(true)
  })

  test("CPL readiness blocks missing, malformed, and unknown placements while preserving DNP intent", () => {
    const result = generatePickAndPlace([
      { type: "source_component", source_component_id: "sc1", name: "R1" },
      { type: "source_component", source_component_id: "sc2", name: "R2" },
      { type: "source_component", source_component_id: "sc3", name: "R3" },
      { type: "source_component", source_component_id: "sc4", name: "R4", do_not_place: true },
      { type: "pcb_component", source_component_id: "sc2", center: { x: "bad", y: 0 }, layer: "top" },
      { type: "pcb_component", source_component_id: "sc3", do_not_place: true },
      { type: "pcb_component", source_component_id: "missing", center: { x: 0, y: 0 }, layer: "top" },
    ])
    expect(result.assemblyReady).toBe(false)
    expect(result.intentionallySkipped).toBe(2)
    expect(result.blockers.map((blocker) => blocker.type)).toEqual(["missing_placement", "malformed_placement", "unknown_source_mapping"])
  })

  test("assembly API returns placement blockers instead of exporting a partial CPL", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-assembly-gate-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "board")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
    await writeFile(
      path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
      JSON.stringify([{ type: "source_component", source_component_id: "sc1", name: "R1", manufacturer_part_number: "RES-10K" }]),
    )
    await stampProject(projectDir)
    const response = await createPcbApi(workspace).request(`/projects/${encodeURIComponent(encodeProjectId("board"))}/assembly.csv`)
    expect(response.status).toBe(409)
    const body = (await response.json()) as { assemblyReady: boolean; assemblyBlockers: Array<{ type: string }> }
    expect(body.assemblyReady).toBe(false)
    expect(body.assemblyBlockers).toEqual(expect.arrayContaining([expect.objectContaining({ type: "missing_placement" })]))
  })

  test("BOM tool explains assembly readiness failures", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-tool-blockers-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "board")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
    await writeFile(
      path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
      JSON.stringify([{ type: "source_component", source_component_id: "sc1", name: "R1", manufacturer_part_number: "RES-10K" }]),
    )
    await stampProject(projectDir)

    const hooks = await createPcbStudioPlugin()({ directory: workspace } as any)
    const output = await hooks.tool?.pcb_bom_generate.execute({ projectId: encodeProjectId("board") }, {} as any)
    const result = JSON.parse(output as string)
    expect(result.assemblyReady).toBe(false)
    expect(result.manufacturingBlockers).toEqual([])
    expect(result.assemblyBlockers).toEqual(expect.arrayContaining([expect.objectContaining({ type: "missing_placement" })]))
  })

  test("simulation API exposes only simulation state, independent of production readiness", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-simulation-api-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "board")
    const circuitDir = path.join(projectDir, "dist", "src", "circuit")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(circuitDir, { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export default () => null\n")
    await writeFile(
      path.join(circuitDir, "circuit.json"),
      JSON.stringify([
        { type: "pcb_trace_error", message: "Fabrication is blocked" },
        { type: "simulation_experiment", simulation_experiment_id: "sim1", name: "load_step" },
        {
          type: "simulation_transient_voltage_graph",
          simulation_experiment_id: "sim1",
          name: "VOUT",
          timestamps_ms: [0, 1],
          voltage_levels: [0, 3.3],
        },
      ]),
    )
    await stampProject(projectDir)

    const response = await createPcbApi(workspace).request(`/projects/${encodeURIComponent(encodeProjectId("board"))}/simulation`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.simulationSuccess).toBe(true)
    expect(body.diagnostics).toEqual([])
    expect(body.experiments).toEqual(expect.arrayContaining([expect.objectContaining({ name: "load_step" })]))
    expect(body).not.toHaveProperty("designValid")
    expect(body).not.toHaveProperty("fabricationReady")
    expect(body).not.toHaveProperty("assemblyReady")
  })

  test("simulation success requires probe graphs and no sim/spice diagnostics", () => {
    const graphs = [
      { type: "simulation_experiment", simulation_experiment_id: "sim1", name: "load_step" },
      {
        type: "simulation_transient_voltage_graph",
        simulation_experiment_id: "sim1",
        name: "VOUT",
        timestamps_ms: [0, 1],
        voltage_levels: [0, 3.3],
      },
    ]
    expect(extractAnalogSimulationDiagnostics(graphs)).toEqual([])
    expect(extractAnalogSimulationExperiments(graphs)).toHaveLength(1)

    const rejectedModel = [
      ...graphs,
      {
        type: "source_invalid_component_property_error",
        message: "Invalid spicePinMapping for U1: pin 'OUT' not found",
      },
    ]
    expect(extractAnalogSimulationDiagnostics(rejectedModel)).toEqual([
      "Invalid spicePinMapping for U1: pin 'OUT' not found",
    ])
    expect(extractAnalogSimulationExperiments(rejectedModel)).toHaveLength(1)

    const engineFail = [
      { type: "simulation_experiment", simulation_experiment_id: "sim1", name: "load_step" },
      { type: "simulation_unknown_experiment_error", message: "ngspice failed: singular matrix" },
    ]
    expect(extractAnalogSimulationDiagnostics(engineFail)).toEqual(["ngspice failed: singular matrix"])
    expect(extractAnalogSimulationExperiments(engineFail)).toEqual([])
  })

  test("simulation API fails closed when graphs coexist with spice model errors", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-simulation-fail-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "board")
    const circuitDir = path.join(projectDir, "dist", "src", "circuit")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(circuitDir, { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export default () => null\n")
    await writeFile(
      path.join(circuitDir, "circuit.json"),
      JSON.stringify([
        { type: "simulation_experiment", simulation_experiment_id: "sim1", name: "load_step" },
        {
          type: "simulation_transient_voltage_graph",
          simulation_experiment_id: "sim1",
          name: "VOUT",
          timestamps_ms: [0, 1],
          voltage_levels: [0, 3.3],
        },
        {
          type: "source_invalid_component_property_error",
          message: "spiceModel rejected: incomplete spicePinMapping",
        },
      ]),
    )
    await stampProject(projectDir)

    const response = await createPcbApi(workspace).request(`/projects/${encodeURIComponent(encodeProjectId("board"))}/simulation`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { simulationSuccess: boolean; diagnostics: string[]; experiments: unknown[] }
    expect(body.simulationSuccess).toBe(false)
    expect(body.diagnostics).toEqual(["spiceModel rejected: incomplete spicePinMapping"])
    expect(body.experiments).toHaveLength(1)
  })

  test("invalid on-disk spiceModel is counted malformed and not treated as a clean part", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-spice-malformed-"))
    temps.push(workspace)
    await mkdir(path.join(workspace, "catalog", "parts"), { recursive: true })
    await writeFile(
      path.join(workspace, "catalog", "parts", "BAD-SPICE.yaml"),
      `mpn: BAD-SPICE
manufacturer: Example
spiceModel:
  source: ".SUBCKT X A\\n.ENDS X"
  sourceUrl: "https://example.com/model.lib"
  pinMapping:
    A: pin1
    B: pin2
`,
    )
    await writeFile(
      path.join(workspace, "catalog", "parts", "GOOD.yaml"),
      `mpn: GOOD
manufacturer: Example
`,
    )
    const catalog = await inspectCatalog(workspace)
    expect(catalog.malformedCount).toBe(1)
    expect(catalog.parts.map((part) => part.mpn).sort()).toEqual(["GOOD"])
    expect(await getCatalogPart(workspace, "BAD-SPICE")).toBeNull()
  })

  test("build and simulation tools keep their status axes separate", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-tool-axis-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "board")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export default () => null\n")
    const hooks = await createPcbStudioPlugin({ workspaceRoot: workspace })({ directory: workspace } as any)

    const buildOutput = JSON.parse(
      (await hooks.tool?.pcb_circuit_build.execute({ projectId: encodeProjectId("board") }, {} as any)) as string,
    )
    expect(buildOutput).not.toHaveProperty("simulationSuccess")
  })

  test("source and config changes invalidate every exposed artifact", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-freshness-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "board")
    const circuitDir = path.join(projectDir, "dist", "src", "circuit")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(circuitDir, { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), 'import "./parts"\n')
    await writeFile(path.join(projectDir, "src", "parts.ts"), "export const value = 1\n")
    await writeFile(path.join(projectDir, "tsconfig.json"), "{}\n")
    await writeFile(path.join(circuitDir, "circuit.json"), "[]")
    await writeFile(path.join(projectDir, "dist", "pcb.svg"), "<svg />")
    await writeFile(path.join(projectDir, "dist", "circuit-gerbers.zip"), "zip")
    await stampProject(projectDir)

    expect((await discoverProjects(workspace))[0]).toEqual(
      expect.objectContaining({ artifactStatus: "fresh", hasCircuitJson: true, hasPcbSvg: true, hasGerbersZip: true }),
    )
    await writeFile(path.join(projectDir, "src", "parts.ts"), "export const value = 2\n")
    const stale = (await discoverProjects(workspace))[0]!
    expect(stale).toEqual(
      expect.objectContaining({ artifactStatus: "stale", hasCircuitJson: false, hasPcbSvg: false, hasGerbersZip: false }),
    )
    expect(stale.artifactError).toMatch(/changed.*pcb_circuit_build/i)

    await stampProject(projectDir)
    await writeFile(path.join(projectDir, "tsconfig.json"), '{"compilerOptions":{"strict":true}}\n')
    expect((await discoverProjects(workspace))[0]).toEqual(expect.objectContaining({ artifactStatus: "stale", hasCircuitJson: false }))

    const app = createPcbApi(workspace)
    const response = await app.request(`/projects/${encodeURIComponent(encodeProjectId("board"))}/bom`)
    expect(response.status).toBe(409)
  })

  test("artifacts without a build-input stamp are stale", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-unstamped-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "board")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(path.join(projectDir, "dist", "src", "circuit"), { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
    await writeFile(path.join(projectDir, "dist", "src", "circuit", "circuit.json"), "[]")
    expect((await discoverProjects(workspace))[0]).toEqual(expect.objectContaining({ artifactStatus: "stale", hasCircuitJson: false }))
  })

  test("Gerber GET returns 409 when fabrication blockers exist", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-gerber-get-"))
    temps.push(workspace)
    const projectDir = path.join(workspace, "blocked-board")
    const circuitDir = path.join(projectDir, "dist", "src", "circuit")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(circuitDir, { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export default () => null\n")
    await writeFile(path.join(circuitDir, "circuit.json"), JSON.stringify([{ type: "pcb_trace_error", message: "Trace is incomplete" }]))
    await writeFile(path.join(projectDir, "dist", "circuit-gerbers.zip"), "fake-zip")
    await stampProject(projectDir)

    const app = createPcbApi(workspace)
    const id = encodeProjectId("blocked-board")
    const res = await app.request(`/projects/${encodeURIComponent(id)}/gerbers.zip`)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; fabricationReady: boolean }
    expect(body.fabricationReady).toBe(false)
    expect(body.error).toMatch(/blocked/i)
  })

  test("catalog exact lookup uses parsed MPNs and resolves duplicates deterministically", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-catalog-"))
    temps.push(workspace)
    const catalogDir = path.join(workspace, "catalog", "parts")
    await mkdir(catalogDir, { recursive: true })
    await writeFile(path.join(catalogDir, "a-file.yaml"), "mpn: INTERNAL-123\ndescription: first\n")
    await writeFile(path.join(catalogDir, "z-file.yaml"), "mpn: INTERNAL-123\ndescription: second\n")
    expect(await getCatalogPart(workspace, " internal-123 ")).toEqual(
      expect.objectContaining({ mpn: "INTERNAL-123", description: "first" }),
    )
  })

  test("catalog upsert creates and merges part YAML under catalog/parts", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-catalog-upsert-"))
    temps.push(workspace)
    const created = await upsertCatalogPart(workspace, {
      mpn: "ESP32-S3-WROOM-1-N16R8",
      manufacturer: "Espressif",
      description: "Wi-Fi MCU module",
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.created).toBe(true)
    expect(created.path).toBe("catalog/parts/ESP32-S3-WROOM-1-N16R8.yaml")
    expect(await getCatalogPart(workspace, "ESP32-S3-WROOM-1-N16R8")).toEqual(
      expect.objectContaining({ mpn: "ESP32-S3-WROOM-1-N16R8", manufacturer: "Espressif" }),
    )

    const merged = await upsertCatalogPart(workspace, {
      mpn: "ESP32-S3-WROOM-1-N16R8",
      datasheet: "https://example.com/esp32.pdf",
    })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.created).toBe(false)
    expect(merged.part).toEqual(
      expect.objectContaining({
        manufacturer: "Espressif",
        description: "Wi-Fi MCU module",
        datasheet: "https://example.com/esp32.pdf",
      }),
    )

    const slash = await upsertCatalogPart(workspace, {
      mpn: "TLV9062IDR/R",
      manufacturer: "TI",
      description: "op-amp",
    })
    expect(slash.ok).toBe(true)
    if (!slash.ok) return
    expect(slash.created).toBe(true)
    expect(slash.path).toBe(`catalog/parts/${encodeURIComponent("TLV9062IDR/R")}.yaml`)
    expect(await getCatalogPart(workspace, "TLV9062IDR/R")).toEqual(expect.objectContaining({ mpn: "TLV9062IDR/R", manufacturer: "TI" }))

    const paren = await upsertCatalogPart(workspace, { mpn: "part(1)", description: "paren mpn" })
    expect(paren.ok).toBe(true)
    if (!paren.ok) return
    expect(paren.path).toBe(`catalog/parts/${encodeURIComponent("part(1)")}.yaml`)
    expect(await getCatalogPart(workspace, "part(1)")).toEqual(expect.objectContaining({ mpn: "part(1)" }))

    const cased = await upsertCatalogPart(workspace, {
      mpn: "esp32-s3-wroom-1-n16r8",
      category: "MCU module",
    })
    expect(cased.ok).toBe(true)
    if (!cased.ok) return
    expect(cased.created).toBe(false)
    expect(cased.path).toBe("catalog/parts/ESP32-S3-WROOM-1-N16R8.yaml")
    expect(cased.part.mpn).toBe("ESP32-S3-WROOM-1-N16R8")
    expect(cased.part.category).toBe("MCU module")
    expect(cased.part.manufacturer).toBe("Espressif")
    const catalogFiles = await readdir(path.join(workspace, "catalog", "parts"))
    expect(catalogFiles.filter((name) => name.toLowerCase().includes("esp32-s3-wroom")).sort()).toEqual(["ESP32-S3-WROOM-1-N16R8.yaml"])
    expect(await getCatalogPart(workspace, "ESP32-S3-WROOM-1-N16R8")).toEqual(
      expect.objectContaining({ category: "MCU module", manufacturer: "Espressif" }),
    )

    const app = createPcbApi(workspace)
    const res = await app.request("/catalog/AMS1117-3.3", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manufacturer: "Advanced Monolithic", category: "LDO" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { created: boolean; part: { mpn: string } }
    expect(body.created).toBe(true)
    expect(body.part.mpn).toBe("AMS1117-3.3")
  })

  test("catalog stores validated self-contained SPICE models with provenance and mapping", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-spice-catalog-"))
    temps.push(workspace)
    const source = `.SUBCKT TEST_DIODE ANODE CATHODE
D1 ANODE CATHODE DTEST
.MODEL DTEST D(IS=1e-14)
.ENDS TEST_DIODE
`
    await upsertCatalogPart(workspace, { mpn: "DIODE-TEST", manufacturer: "Example" })
    const result = await upsertCatalogPart(workspace, {
      mpn: "DIODE-TEST",
      spiceModel: {
        source,
        sourceUrl: "https://manufacturer.example/models/diode.lib",
        pinMapping: { ANODE: "pin1", CATHODE: "pin2" },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.part.spiceModel).toEqual(
      expect.objectContaining({
        subcircuit: "TEST_DIODE",
        pins: ["ANODE", "CATHODE"],
        pinMapping: { ANODE: "pin1", CATHODE: "pin2" },
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
    expect(spiceModelSnippet(result.part)).toContain("spicePinMapping")
    expect((await getCatalogPart(workspace, "DIODE-TEST"))?.spiceModel?.source).toBe(source)

    const apiBody = await (await createPcbApi(workspace).request(`/catalog/${encodeURIComponent("DIODE-TEST")}`)).json()
    expect(JSON.stringify(apiBody)).not.toContain(".SUBCKT")
    expect(apiBody).toEqual(
      expect.objectContaining({ part: expect.objectContaining({ spiceModel: expect.objectContaining({ subcircuit: "TEST_DIODE" }) }) }),
    )
  })

  test("SPICE model validation rejects incomplete mappings and executable/external directives", () => {
    const base = {
      sourceUrl: "https://manufacturer.example/models/opamp.lib",
      pinMapping: { OUT: "pin1" },
    }
    expect(validateSpiceModel({ ...base, source: ".SUBCKT OPAMP OUT IN\nR1 OUT IN 1k\n.ENDS OPAMP" })).toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining("map every") }),
    )
    expect(
      validateSpiceModel({
        ...base,
        source: ".SUBCKT OPAMP OUT\n.include https://example.com/model.lib\n.ENDS OPAMP",
      }),
    ).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining("self-contained") }))
    expect(
      validateSpiceModel({
        ...base,
        source: ".SUBCKT OPAMP OUT\n.control\nshell rm -rf /\n.endc\n.ENDS OPAMP",
      }),
    ).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining("self-contained") }))
  })

  test("SPICE model validation selects a top-level subcircuit while preserving helper models", () => {
    const source = `.SUBCKT HELPER A B PARAMS: R=1k
R1 A B 1k
.ENDS HELPER
.SUBCKT TOP IN OUT VCC
+ GND
X1 IN OUT HELPER
.ENDS TOP
`
    const base = {
      source,
      sourceUrl: "https://manufacturer.example/models/amplifier.lib",
      pinMapping: { IN: "pin1", OUT: "pin2", VCC: "pin3", GND: "pin4" },
    }

    expect(validateSpiceModel(base)).toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining("subcircuit is required") }),
    )
    expect(validateSpiceModel({ ...base, subcircuit: "MISSING" })).toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining("must select one") }),
    )

    const result = validateSpiceModel({ ...base, subcircuit: "top" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model).toEqual(
      expect.objectContaining({
        subcircuit: "TOP",
        pins: ["IN", "OUT", "VCC", "GND"],
        pinMapping: base.pinMapping,
      }),
    )
    expect(result.model.source.indexOf(".SUBCKT TOP")).toBe(0)
    expect(result.model.source).toContain(".SUBCKT HELPER")

    expect(
      validateSpiceModel({
        ...base,
        source: ".SUBCKT TOP IN OUT PARAMS: GAIN=2\nR1 IN OUT 1k\n.ENDS TOP",
        subcircuit: "TOP",
        pinMapping: { IN: "pin1", OUT: "pin2" },
      }),
    ).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining("parameters are not supported") }))
  })

  test("dedicated SPICE model tools require an exact catalog MPN and return a usable snippet", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-spice-tools-"))
    temps.push(workspace)
    await upsertCatalogPart(workspace, { mpn: "DIODE-TEST", manufacturer: "Example" })
    const hooks = await createPcbStudioPlugin({ workspaceRoot: workspace })({ directory: workspace } as any)
    const source = ".SUBCKT TEST_DIODE ANODE CATHODE\nD1 ANODE CATHODE DTEST\n.MODEL DTEST D\n.ENDS TEST_DIODE\n"

    const upsert = JSON.parse(
      (await hooks.tool?.pcb_spice_model_upsert.execute(
        {
          mpn: "DIODE-TEST",
          source,
          sourceUrl: "https://manufacturer.example/models/diode.lib",
          pinMapping: { ANODE: "pin1", CATHODE: "pin2" },
        },
        {} as any,
      )) as string,
    )
    expect(upsert.success).toBe(true)
    expect(upsert.tscircuitSnippet).toContain("<spicemodel")

    const got = JSON.parse((await hooks.tool?.pcb_spice_model_get.execute({ mpn: "DIODE-TEST" }, {} as any)) as string)
    expect(got.success).toBe(true)
    expect(got.model).toEqual(expect.objectContaining({ source, pinMapping: { ANODE: "pin1", CATHODE: "pin2" } }))

    const multiSource = `.SUBCKT HELPER A K
D1 A K DTEST
.MODEL DTEST D
.ENDS HELPER
.SUBCKT TEST_DIODE ANODE CATHODE
X1 ANODE CATHODE HELPER
.ENDS TEST_DIODE
`
    const selected = JSON.parse(
      (await hooks.tool?.pcb_spice_model_upsert.execute(
        {
          mpn: "DIODE-TEST",
          source: multiSource,
          sourceUrl: "https://manufacturer.example/models/diode.lib",
          subcircuit: "TEST_DIODE",
          pinMapping: { ANODE: "pin1", CATHODE: "pin2" },
        },
        {} as any,
      )) as string,
    )
    expect(selected.success).toBe(true)
    expect(selected.part.spiceModel.subcircuit).toBe("TEST_DIODE")
    expect(selected.tscircuitSnippet).toContain('source={".SUBCKT TEST_DIODE')

    const missing = JSON.parse(
      (await hooks.tool?.pcb_spice_model_upsert.execute(
        {
          mpn: "NOT-CATALOGUED",
          source,
          sourceUrl: "https://manufacturer.example/models/diode.lib",
          pinMapping: { ANODE: "pin1", CATHODE: "pin2" },
        },
        {} as any,
      )) as string,
    )
    expect(missing).toEqual(expect.objectContaining({ success: false, reason: "part_not_found" }))
  })

  test("projects endpoint supports paged and single-snapshot complete lists", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "pcb-pagination-"))
    temps.push(workspace)
    for (const name of ["a-board", "b-board"]) {
      const projectDir = path.join(workspace, name)
      await mkdir(path.join(projectDir, "src"), { recursive: true })
      await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export {}\n")
    }
    const app = createPcbApi(workspace)
    expect(await (await app.request("/workspace")).json()).toEqual({ root: workspace })
    expect(await (await app.request(`/workspace?projectId=${encodeURIComponent(encodeProjectId("missing/board"))}`)).json()).toEqual({
      root: workspace,
      path: "missing/board",
      directory: path.join(workspace, "missing", "board"),
    })
    const page = (await (await app.request("/projects?offset=1&limit=1")).json()) as any
    expect(page.total).toBe(2)
    expect(page.projects.map((project: { name: string }) => project.name)).toEqual(["b-board"])
    const all = (await (await app.request("/projects?all=1")).json()) as any
    expect(all.hasMore).toBe(false)
    expect(all.projects.map((project: { name: string }) => project.name)).toEqual(["a-board", "b-board"])
  })

  test("runProjectBuild falls back to bundled tsci when npm is unavailable", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-npm-fallback-"))
    temps.push(projectDir)
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export default () => <board />\n")
    await writeFile(path.join(projectDir, "package.json"), JSON.stringify({ name: "fallback-board", private: true }))

    const result = await runProjectBuild(projectDir, { npmPath: null })
    // tsci may fail on invalid circuit; path under test is "did not throw / used tsci path"
    expect(typeof result.exitCode).toBe("number")
    expect(result).toHaveProperty("processSuccess")
    expect(result).toHaveProperty("artifacts")
  }, 15_000)
})
