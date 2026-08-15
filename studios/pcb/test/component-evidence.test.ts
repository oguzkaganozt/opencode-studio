import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  COMPONENT_EVIDENCE_SCHEMA,
  createComponentEvidence,
  fingerprintComponent,
  matchComplexComponentInstances,
  readComponentEvidence,
  writeComponentEvidence,
} from "../component-evidence"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function circuit(options: { refdes?: string; ids?: string; x?: number; y?: number; rotation?: number; reverse?: boolean } = {}) {
  const refdes = options.refdes ?? "U1"
  const suffix = options.ids ?? "a"
  const x = options.x ?? 10
  const y = options.y ?? 20
  const rotation = options.rotation ?? 0
  const rotate = (dx: number, dy: number) => {
    const turns = (((rotation / 90) % 4) + 4) % 4
    for (let index = 0; index < turns; index++) [dx, dy] = [-dy, dx]
    return { x: x + dx, y: y + dy }
  }
  const elements = [
    {
      type: "source_component",
      source_component_id: `sc-${suffix}`,
      name: refdes,
      ftype: "complex",
      manufacturer: "Acme",
      manufacturer_part_number: "MCU-42",
      supplier_part_numbers: { mouser: [" 123 ", "123"], jlcpcb: ["C42"] },
    },
    {
      type: "source_port",
      source_port_id: `sp1-${suffix}`,
      source_component_id: `sc-${suffix}`,
      name: "VCC",
      port_hints: ["pin1", "VCC", "1"],
      is_power: true,
    },
    {
      type: "source_port",
      source_port_id: `sp2-${suffix}`,
      source_component_id: `sc-${suffix}`,
      name: "IO",
      port_hints: ["2", "GPIO"],
      is_bidir: true,
    },
    {
      type: "pcb_component",
      pcb_component_id: `pc-${suffix}`,
      source_component_id: `sc-${suffix}`,
      center: { x, y },
      rotation,
    },
    {
      type: "pcb_port",
      pcb_port_id: `pp1-${suffix}`,
      source_port_id: `sp1-${suffix}`,
      pcb_component_id: `pc-${suffix}`,
    },
    {
      type: "pcb_port",
      pcb_port_id: `pp2-${suffix}`,
      source_port_id: `sp2-${suffix}`,
      pcb_component_id: `pc-${suffix}`,
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: `pad1-${suffix}`,
      pcb_port_id: `pp1-${suffix}`,
      center: rotate(-1.00000001, 0),
      width: 0.60000001,
      height: 1.2,
      shape: "rect",
      layers: ["top"],
      rotation,
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: `pad2-${suffix}`,
      pcb_port_id: `pp2-${suffix}`,
      center: rotate(1, 0),
      width: 0.6,
      height: 1.2,
      shape: "rect",
      layers: ["top"],
      rotation,
    },
  ]
  return options.reverse ? elements.reverse() : elements
}

const provenance = { spec: "@tsci/acme-mcu", version: "1.2.3", export: "AcmeMcu" }

describe("component implementation evidence", () => {
  test("is invariant to order, generated ids, refdes, translation, quarter turns, and quantization noise", () => {
    const first = fingerprintComponent(circuit(), "U1")
    const transformed = fingerprintComponent(
      circuit({ refdes: "IC99", ids: "generated-999", x: -300, y: 98.5, rotation: 270, reverse: true }),
      "IC99",
    )
    expect(transformed).toEqual(first)
    expect(first.footprint.pads.map((pad) => pad.x).sort()).toEqual([-1, 1])
    expect(first.identity.suppliers).toEqual([
      { supplier: "jlcpcb", partNumbers: ["C42"] },
      { supplier: "mouser", partNumbers: ["123"] },
    ])
  })

  test("captures interface changes and matches only actual complex instances", () => {
    const evidence = createComponentEvidence(circuit(), "U1", provenance)
    const changed = circuit()
    ;(changed.find((entry) => entry.type === "source_port" && entry.name === "IO") as Record<string, unknown>).is_bidir = false
    const result = matchComplexComponentInstances(changed, [evidence])
    expect(result).toHaveLength(1)
    expect(result[0]?.matched).toBe(false)
    expect(result[0]?.mismatches).toEqual(["interface"])

    const simple = circuit()
    ;(simple[0] as Record<string, unknown>).ftype = "simple_chip"
    expect(matchComplexComponentInstances(simple, [evidence])).toEqual([])
  })

  test("fails closed for missing source-pin to PCB-port or physical-pad mappings", () => {
    const missingPort = circuit().filter((entry) => !(entry.type === "pcb_port" && entry.source_port_id === "sp2-a"))
    expect(() => fingerprintComponent(missingPort, "U1")).toThrow("no PCB-port mapping")
    const missingPad = circuit().filter((entry) => !(entry.type === "pcb_smtpad" && entry.pcb_port_id === "pp2-a"))
    expect(() => fingerprintComponent(missingPad, "U1")).toThrow("no physical pad mapping")
  })

  test("writes atomically and reads a verified, bounded versioned evidence file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-evidence-"))
    temporaryDirectories.push(root)
    const file = { schema: COMPONENT_EVIDENCE_SCHEMA, records: [createComponentEvidence(circuit(), "U1", provenance)] }
    const written = await writeComponentEvidence(root, file)
    expect(await readComponentEvidence(root)).toEqual(file)
    expect(JSON.parse(await readFile(written, "utf8"))).toEqual(file)

    const tampered = structuredClone(file)
    tampered.records[0]!.identity.manufacturerPartNumber = "OTHER"
    await writeFile(written, JSON.stringify(tampered))
    await expect(readComponentEvidence(root)).rejects.toThrow("digest verification failed")

    await writeFile(written, JSON.stringify({ ...file, schema: 2 }))
    await expect(readComponentEvidence(root)).rejects.toThrow("Unsupported component evidence schema")
  })

  test("rejects path escape, symlink roots, symlink parents, and oversized files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-evidence-security-"))
    const outside = await mkdtemp(path.join(os.tmpdir(), "component-evidence-outside-"))
    temporaryDirectories.push(root, outside)
    const file = { schema: COMPONENT_EVIDENCE_SCHEMA, records: [createComponentEvidence(circuit(), "U1", provenance)] }
    await expect(writeComponentEvidence(root, file, "../escape.json")).rejects.toThrow("escapes project root")

    await symlink(outside, path.join(root, "linked"))
    await expect(writeComponentEvidence(root, file, "linked/evidence.json")).rejects.toThrow("symlink")

    const outsideFile = path.join(outside, "evidence.json")
    await writeFile(outsideFile, "{}")
    await symlink(outsideFile, path.join(root, "target.json"))
    await expect(writeComponentEvidence(root, file, "target.json")).rejects.toThrow("symlink")

    const linkedRoot = `${root}-link`
    await symlink(root, linkedRoot)
    temporaryDirectories.push(linkedRoot)
    await expect(writeComponentEvidence(linkedRoot, file)).rejects.toThrow("Project root")

    await mkdir(path.join(root, "large"))
    await writeFile(path.join(root, "large", "evidence.json"), Buffer.alloc(512 * 1024 + 1))
    await expect(readComponentEvidence(root, "large/evidence.json")).rejects.toThrow("exceeds")
  })
})
