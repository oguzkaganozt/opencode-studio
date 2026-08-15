import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { type CircuitCheckDependencies, checkCircuit, MAX_CIRCUIT_CHECK_ISSUES, SHORTS_CONFIG } from "../circuit-check"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function fixture(elements: unknown[] = []) {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "pcb-circuit-check-test-"))
  tempDirs.push(projectDir)
  const circuitJsonPath = path.join(projectDir, "circuit.json")
  await writeFile(circuitJsonPath, JSON.stringify(elements))
  return { projectDir, circuitJsonPath }
}

const noChecks: Pick<CircuitCheckDependencies, "runNetlist" | "runPlacement"> = {
  runNetlist: async () => [],
  runPlacement: async () => [],
}

describe("deterministic PCB circuit checks", () => {
  test("runs the pinned in-process APIs", async () => {
    const input = await fixture()
    const result = await checkCircuit({ ...input, options: { checks: ["netlist", "placement"] } })
    expect(result).toEqual(expect.objectContaining({ executionOk: true, clean: true, issueCount: 0 }))
  })

  test("normalizes API findings, orders checks, and filters placement by refdes", async () => {
    const input = await fixture([
      { type: "source_component", source_component_id: "source_u1", name: "U1" },
      { type: "source_component", source_component_id: "source_r1", name: "R1" },
      { type: "pcb_component", pcb_component_id: "pcb_u1", source_component_id: "source_u1" },
      { type: "pcb_component", pcb_component_id: "pcb_r1", source_component_id: "source_r1" },
    ])
    const result = await checkCircuit(
      { ...input, options: { checks: ["placement", "netlist"], placementRefdes: "U1" } },
      {
        runNetlist: async () => [
          { type: "source_pin_must_be_connected_error", message: "U1 pin is floating", source_component_id: "source_u1" },
        ],
        runPlacement: async () => [
          { type: "pcb_component_outside_board_error", message: "R1 is outside", pcb_component_id: "pcb_r1" },
          { type: "pcb_component_outside_board_error", message: "U1 is outside", pcb_component_id: "pcb_u1" },
        ],
      },
    )

    expect(result.executionOk).toBe(true)
    expect(result.clean).toBe(false)
    expect(result.checks.map((check) => check.check)).toEqual(["netlist", "placement"])
    expect(result.issues.map((issue) => issue.message)).toEqual(["U1 pin is floating", "U1 is outside"])
    expect(result.issues.map((issue) => issue.refdes)).toEqual([["U1"], ["U1"]])
  })

  test("uses the fixed shorts contract and parses structured findings", async () => {
    const input = await fixture()
    let received: unknown
    const result = await checkCircuit(
      { ...input, options: { checks: ["shorts"] } },
      {
        ...noChecks,
        runShorts: async (shortsInput) => {
          received = shortsInput
          return {
            exitCode: 1,
            stdout: [
              "Detected 1 short in circuit.json",
              "1. top/gerber short at x=1.250mm y=-2.500mm",
              "   U1.1, trace_a <-> R1.1",
              "   pixels=7",
            ].join("\n"),
            stderr: "",
          }
        },
      },
    )

    expect(received).toEqual({ circuitJsonPath: input.circuitJsonPath, config: SHORTS_CONFIG })
    expect(result).toEqual(
      expect.objectContaining({ executionOk: true, clean: false, issueCount: 1, omittedIssueCount: 0, shortsConfig: SHORTS_CONFIG }),
    )
    expect(result.issues[0]).toEqual(
      expect.objectContaining({
        type: "pcb_short",
        layer: "top",
        center: { x: 1.25, y: -2.5 },
        owners: [["U1.1", "trace_a"], ["R1.1"]],
        pixelCount: 7,
      }),
    )
  })

  test("distinguishes a clean run from execution failure", async () => {
    const input = await fixture()
    const clean = await checkCircuit(
      { ...input, options: { checks: ["shorts"] } },
      { ...noChecks, runShorts: async () => ({ exitCode: 0, stdout: "No shorts detected in circuit.json", stderr: "" }) },
    )
    expect(clean).toEqual(expect.objectContaining({ executionOk: true, clean: true, issueCount: 0 }))

    const failed = await checkCircuit(
      { ...input, options: { checks: ["shorts"] } },
      { ...noChecks, runShorts: async () => ({ exitCode: 2, stdout: "", stderr: "renderer failed" }) },
    )
    expect(failed).toEqual(
      expect.objectContaining({ executionOk: false, clean: false, error: { code: "check_failed", message: "renderer failed" } }),
    )
  })

  test("caps findings while preserving the total count", async () => {
    const input = await fixture()
    const result = await checkCircuit(
      { ...input, options: { checks: ["netlist"] } },
      {
        runNetlist: async () =>
          Array.from({ length: MAX_CIRCUIT_CHECK_ISSUES + 3 }, (_, index) => ({
            type: "netlist_error",
            message: `issue ${String(index).padStart(3, "0")}`,
          })),
      },
    )
    expect(result.issues).toHaveLength(MAX_CIRCUIT_CHECK_ISSUES)
    expect(result.issueCount).toBe(MAX_CIRCUIT_CHECK_ISSUES + 3)
    expect(result.omittedIssueCount).toBe(3)
  })

  test("rejects invalid options and paths before invoking checks", async () => {
    const input = await fixture()
    let invoked = false
    const result = await checkCircuit(
      { ...input, circuitJsonPath: path.join(input.projectDir, "..", "outside.json"), options: { checks: ["netlist"] } },
      {
        runNetlist: async () => {
          invoked = true
          return []
        },
      },
    )
    expect(invoked).toBe(false)
    expect(result).toEqual(
      expect.objectContaining({ executionOk: false, clean: false, error: expect.objectContaining({ code: "invalid_input" }) }),
    )

    const duplicate = await checkCircuit({ ...input, options: { checks: ["netlist", "netlist"] } })
    expect(duplicate.error?.code).toBe("invalid_input")
  })
})
