import { describe, expect, test } from "bun:test"
import {
  createPcbSelectionHandoff,
  createPcbSelectionIndex,
  pickNetFromSchematicPort,
  pickPcbRegion,
  pickSchematicComponent,
} from "../viewer/src/agent-selection"

const circuit = [
  { type: "source_component", source_component_id: "sc-u1", name: "U1", manufacturer_part_number: "MCU-1" },
  { type: "source_component", source_component_id: "sc-r1", name: "R1" },
  { type: "source_component", source_component_id: "sc-c1", name: "C1" },
  {
    type: "schematic_component",
    schematic_component_id: "sch-u1",
    schematic_sheet_id: "sheet-1",
    source_component_id: "sc-u1",
    symbol_display_value: "MCU",
  },
  {
    type: "pcb_component",
    pcb_component_id: "pcb-u1",
    source_component_id: "sc-u1",
    center: { x: 4, y: -2 },
    width: 8,
    height: 6,
    rotation: 90,
    layer: "top",
  },
  { type: "schematic_port", schematic_port_id: "sch-port-1", source_port_id: "port-1" },
  { type: "source_port", source_port_id: "port-1", source_component_id: "sc-u1", name: "VCC" },
  { type: "source_port", source_port_id: "port-2", source_component_id: "sc-r1", name: "1" },
  { type: "source_port", source_port_id: "port-3", source_component_id: "sc-c1", name: "1" },
  {
    type: "source_trace",
    source_trace_id: "trace-1",
    connected_source_port_ids: ["port-1", "port-2"],
    connected_source_net_ids: ["net-vcc"],
  },
  {
    type: "source_trace",
    source_trace_id: "trace-2",
    connected_source_port_ids: ["port-2", "port-3"],
    connected_source_net_ids: ["net-vcc"],
  },
  { type: "source_net", source_net_id: "net-vcc", name: "VCC", member_source_group_ids: [] },
  { type: "schematic_trace", schematic_trace_id: "sch-trace-1", source_trace_id: "trace-1" },
  { type: "pcb_trace", pcb_trace_id: "pcb-trace-2", source_trace_id: "trace-2" },
]

describe("PCB graphical Agent selections", () => {
  const index = createPcbSelectionIndex(circuit)

  test("maps a schematic component to source and placement context", () => {
    const selection = pickSchematicComponent(index, "sch-u1")
    expect(selection?.kind).toBe("component")
    expect(selection?.label).toBe("U1")
    expect(selection?.details).toContain("source_component_id=sc-u1")
    expect(selection?.details).toContain("pcb_component_ids=pcb-u1")
    expect(selection?.details.some((line) => line.includes("center=(4,-2)") && line.includes("layer=top"))).toBe(true)
  })

  test("resolves a net from either callback identifier and expands all traces", () => {
    for (const callbackID of ["sch-port-1", "port-1"]) {
      const selection = pickNetFromSchematicPort(index, callbackID)
      expect(selection?.kind).toBe("net")
      expect(selection?.label).toBe("VCC")
      expect(selection?.details).toContain("source_trace_ids=trace-1,trace-2")
      expect(selection?.details).toContain("endpoints=U1.VCC,R1.1,C1.1")
    }
  })

  test("normalizes valid regions and rejects empty bounds", () => {
    const selection = pickPcbRegion({ minX: 5, minY: 3, maxX: -5, maxY: -3 })
    expect(selection?.summary).toBe("10 × 6 mm · center (0, 0)")
    expect(selection?.details[0]).toBe("bounds_mm=min=(-5,-3) max=(5,3)")
    expect(pickPcbRegion({ minX: 1, minY: 1, maxX: 1, maxY: 2 })).toBeNull()
  })

  test("creates a structured project-scoped handoff", () => {
    const selection = pickSchematicComponent(index, "sch-u1")!
    const handoff = createPcbSelectionHandoff("board-id", "/studio/circuits/board", selection)
    expect(handoff.directory).toBe("/studio/circuits/board")
    expect(handoff.paths).toEqual(["/studio/circuits/board"])
    expect(handoff.annotation).toContain("PCB component U1\nproject_id=board-id")
  })
})
