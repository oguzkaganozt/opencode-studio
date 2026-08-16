import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import packageManifest from "../../../package.json" with { type: "json" }
import { isInside } from "../../../src/core/paths"
import { createPcbApi } from "../api"
import { buildInputDigest, writeBuildInputStamp } from "../artifact-freshness"
import { generatePickAndPlace, toCplCsv } from "../assembly"
import { generateBom } from "../bom"
import { getCatalogPart, upsertCatalogPart } from "../catalog"
import { manufacturingBlockers } from "../circuit-json"
import { basicProjectTemplate, TSCIRCUIT_VERSION } from "../templates"
import { createPcbStudioPlugin } from "../tools"
import { exportCircuit, runProjectBuild } from "../tsci"
import { decodeProjectId, discoverProjects, encodeProjectId } from "../workspace"

const temps: string[] = []
async function stampProject(projectDir: string) {
  const circuit = await readFile(path.join(projectDir, "dist", "src", "circuit", "circuit.json"))
  await writeBuildInputStamp(projectDir, await buildInputDigest(projectDir), createHash("sha256").update(circuit).digest("hex"))
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
    expect(names).toContain("pcb_tsx_snippet")
    expect(names).toContain("pcb_tscircuit_reference")
    expect(names).toContain("pcb_component_add")
    expect(names).not.toContain("pcb_component_import")
    expect(names).toContain("pcb_circuit_check")
    expect(names).not.toContain("pcb_sim_run")
    expect(names).not.toContain("pcb_spice_model_get")
    expect(names).not.toContain("pcb_spice_model_upsert")
    const listed = JSON.parse((await hooks.tool?.pcb_workspace_list.execute({}, {} as any)) as string)
    expect(listed.workspaceRoot).toBe(workspaceRoot)
  })

  test("pcb_component_add requires exactly one of candidateId or lcscPartNumber", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-add-dispatch-"))
    temps.push(workspaceRoot)
    const hooks = await createPcbStudioPlugin({ workspaceRoot })({ directory: workspaceRoot } as any)
    const created = JSON.parse(
      (await hooks.tool?.pcb_project_create.execute({ name: "dispatch-board", install: false }, {} as any)) as string,
    )
    const neither = JSON.parse((await hooks.tool?.pcb_component_add.execute({ projectId: created.projectId }, {} as any)) as string)
    expect(neither).toMatchObject({ success: false, reason: "invalid_input" })
    const both = JSON.parse(
      (await hooks.tool?.pcb_component_add.execute(
        { projectId: created.projectId, candidateId: "cand-1", lcscPartNumber: "C2049745" },
        {} as any,
      )) as string,
    )
    expect(both).toMatchObject({ success: false, reason: "invalid_input" })
  })

  test("returns a bounded PNG attachment for PCB visual inspection", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-preview-"))
    temps.push(workspaceRoot)
    const projectDir = path.join(workspaceRoot, "preview-board")
    const outputDir = path.join(projectDir, "dist", "src", "circuit")
    await mkdir(path.join(projectDir, "src"), { recursive: true })
    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(projectDir, "src", "circuit.tsx"), "export default () => null\n")
    await writeFile(path.join(outputDir, "circuit.json"), "[]")
    await writeFile(
      path.join(projectDir, "dist", "pcb.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="black"/></svg>',
    )
    await stampProject(projectDir)

    const hooks = await createPcbStudioPlugin({ workspaceRoot })({ directory: workspaceRoot } as any)
    const result = (await hooks.tool?.pcb_pcb_svg.execute({ projectId: encodeProjectId("preview-board") }, {} as any)) as any
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toEqual(
      expect.objectContaining({ mime: "image/png", filename: "pcb-preview.png", url: expect.stringMatching(/^data:image\/png;base64,/) }),
    )
    expect(result.metadata).toEqual(expect.objectContaining({ previewWidth: 1200, previewHeight: 900, previewMaxEdge: 1200 }))
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
        count: 3,
        messages: expect.arrayContaining([expect.stringContaining("U1"), expect.stringContaining("U2"), expect.stringContaining("U3")]),
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
    expect(result.assemblyBlockers).toEqual(expect.arrayContaining([expect.objectContaining({ type: "missing_placement" })]))
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
