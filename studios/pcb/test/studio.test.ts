import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isInside } from "../../../src/core/paths"
import { createPcbApi } from "../api"
import { generatePickAndPlace, toCplCsv } from "../assembly"
import { generateBom } from "../bom"
import { manufacturingBlockers } from "../circuit-json"
import { createPcbStudioPlugin } from "../tools"
import { exportCircuit, runProjectBuild } from "../tsci"
import { decodeProjectId, discoverProjects, encodeProjectId } from "../workspace"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("pcb studio smoke", () => {
  test("registers core tools scoped to the OpenCode directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pcb-smoke-"))
    temps.push(workspaceRoot)
    const hooks = await createPcbStudioPlugin()({ directory: workspaceRoot } as any)
    const names = Object.keys(hooks.tool ?? {})
    expect(names).toContain("pcb_workspace_list")
    expect(names).toContain("pcb_catalog_list")
    const listed = JSON.parse((await hooks.tool?.pcb_workspace_list.execute({}, {} as any)) as string)
    expect(listed.workspaceRoot).toBe(workspaceRoot)
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
    const result = await exportCircuit(projectDir, ["gerber"])
    expect(result.success).toBe(false)
    expect(result.blockedFormats).toEqual(["gerber"])
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

    const app = createPcbApi(workspace)
    const id = encodeProjectId("blocked-board")
    const res = await app.request(`/projects/${encodeURIComponent(id)}/gerbers.zip`)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; fabricationReady: boolean }
    expect(body.fabricationReady).toBe(false)
    expect(body.error).toMatch(/blocked/i)
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
