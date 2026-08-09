import { describe, expect, test } from "bun:test"
import { circuitElementPage, filterCircuitElements } from "./circuit-json"

describe("Circuit JSON list helpers", () => {
  test("filters top-level fields without serializing nested element data", () => {
    const nested = { toJSON: () => { throw new Error("must not stringify") } }
    const elements = [
      { type: "source_component", name: "Controller", data: nested },
      { type: "pcb_trace", source_net_id: "net-5", data: nested },
    ]

    expect(filterCircuitElements(elements, "controller").map((item) => item.index)).toEqual([0])
    expect(filterCircuitElements(elements, "NET-5").map((item) => item.index)).toEqual([1])
    expect(filterCircuitElements(elements, "source_component").map((item) => item.index)).toEqual([0])
  })

  test("returns a bounded page and clamps stale page indexes", () => {
    const filtered = filterCircuitElements(
      Array.from({ length: 205 }, (_, index) => ({ type: "pcb_trace", id: index })),
      "",
    )

    expect(circuitElementPage(filtered, 1).elements).toHaveLength(100)
    const last = circuitElementPage(filtered, 99)
    expect(last.page).toBe(2)
    expect(last.pageCount).toBe(3)
    expect(last.elements).toHaveLength(5)
  })
})
