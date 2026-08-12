import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { circuitJsonUntampered, writeBuildInputStamp } from "../artifact-freshness"
import { manufacturingBlockers } from "../circuit-json"
import { parseNoConnectIntents } from "../tsx-intent"

const temps: string[] = []

function element(type: string, fields: Record<string, unknown>): Record<string, unknown> {
  return { type, ...fields }
}

describe("engine reconciliation (#4442 stale missing-trace warnings)", () => {
  const elements = [
    element("source_component", { source_component_id: "sc1", name: "SW1" }),
    element("source_port", { source_port_id: "sp0", source_component_id: "sc1", name: "pin1" }),
    element("source_port", { source_port_id: "sp1", source_component_id: "sc1", name: "pin2" }),
    element("source_port", { source_port_id: "sp2", source_component_id: "sc1", name: "pin3" }),
    element("source_trace", { source_trace_id: "st1", connected_source_port_ids: ["sp0", "sp1"] }),
    element("source_pin_missing_trace_warning", { source_port_id: "sp0", message: "pin1 is missing a trace" }),
    element("source_pin_missing_trace_warning", { source_port_id: "sp1", message: "pin2 is missing a trace" }),
    element("source_pin_missing_trace_warning", { source_port_id: "sp2", message: "pin3 is missing a trace" }),
  ]

  test("warnings on trace-connected ports do not block", () => {
    const blockers = manufacturingBlockers(elements)
    const unconnected = blockers.find((blocker) => blocker.type === "unconnected_pin")
    expect(unconnected?.count).toBe(1)
  })

  test("noConnect intent clears the remaining warning without touching the artifact", () => {
    const blockers = manufacturingBlockers(elements, undefined, {
      noConnect: new Map([["SW1", new Set(["pin3"])]]),
    })
    expect(blockers.find((blocker) => blocker.type === "unconnected_pin")).toBeUndefined()
  })
})

describe("noConnect intent bridge (#4443)", () => {
  test("parses noConnect with name in either prop order", () => {
    const source = `
      <switch name="SW1" type="spdt" noConnect={["pin3"]} />
      <switch noConnect={["pin1", "pin2"]} name="SW2" />
    `
    const intents = parseNoConnectIntents(source)
    expect(intents.get("SW1")).toEqual(new Set(["pin3"]))
    expect(intents.get("SW2")).toEqual(new Set(["pin1", "pin2"]))
  })

  test("ignores elements without name or noConnect", () => {
    expect(parseNoConnectIntents('<switch type="spdt" />')).toEqual(new Map())
    expect(parseNoConnectIntents('<board width="10mm" />')).toEqual(new Map())
  })

  test("matches ports via name or port_hints aliases", () => {
    const elements = [
      element("source_component", { source_component_id: "sc1", name: "BT1" }),
      element("source_port", { source_port_id: "sp0", source_component_id: "sc1", name: "pin3", port_hints: ["pin1_alt1", "pin3", "3"] }),
      element("source_pin_missing_trace_warning", { source_port_id: "sp0" }),
    ]
    const blockers = manufacturingBlockers(elements, undefined, {
      noConnect: new Map([["BT1", new Set(["pin3"])]]),
    })
    expect(blockers.find((blocker) => blocker.type === "unconnected_pin")).toBeUndefined()
  })
})

describe("missing_pcb_port gate (#4444)", () => {
  const keystone = [
    element("source_component", { source_component_id: "sc1", name: "BT1" }),
    element("source_port", { source_port_id: "sp0", source_component_id: "sc1", name: "POS", port_hints: ["POS", "pin1", "1"] }),
    element("source_port", { source_port_id: "sp1", source_component_id: "sc1", name: "pin1_internal_1" }),
    element("source_port", { source_port_id: "sp2", source_component_id: "sc1", name: "GND_BT" }),
    element("pcb_port", { pcb_port_id: "pp2", source_port_id: "sp2" }),
  ]

  test("declared pins without a pcb_port block; internal ports are exempt", () => {
    const blockers = manufacturingBlockers(keystone)
    const missing = blockers.find((blocker) => blocker.type === "missing_pcb_port")
    expect(missing?.count).toBe(1)
    expect(missing?.messages[0]).toContain("BT1.POS")
  })

  test("noConnect intent exempts the padless port", () => {
    const blockers = manufacturingBlockers(keystone, undefined, {
      noConnect: new Map([["BT1", new Set(["pin1"])]]),
    })
    expect(blockers.find((blocker) => blocker.type === "missing_pcb_port")).toBeUndefined()
  })
})

describe("artifact integrity (gate bypass shield)", () => {
  async function projectWithCircuit(content: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pcb-integrity-"))
    temps.push(dir)
    const circuitPath = path.join(dir, "dist", "src", "circuit", "circuit.json")
    await mkdir(path.dirname(circuitPath), { recursive: true })
    await writeFile(circuitPath, content)
    return dir
  }

  test("untampered circuit.json passes; post-build edits fail", async () => {
    const content = JSON.stringify([{ type: "source_component", name: "U1" }])
    const dir = await projectWithCircuit(content)
    const circuitPath = path.join(dir, "dist", "src", "circuit", "circuit.json")
    const sha256 = createHash("sha256").update(content).digest("hex")
    await writeBuildInputStamp(dir, "input-digest", sha256)
    expect(await circuitJsonUntampered(dir, circuitPath)).toBe(true)

    await writeFile(circuitPath, `${content}\n`)
    expect(await circuitJsonUntampered(dir, circuitPath)).toBe(false)
    expect(await readFile(circuitPath, "utf8")).toContain("source_component")
  })

  test("missing or stale stamp fails the integrity check", async () => {
    const dir = await projectWithCircuit("[]")
    const circuitPath = path.join(dir, "dist", "src", "circuit", "circuit.json")
    expect(await circuitJsonUntampered(dir, circuitPath)).toBe(false)
  })
})
