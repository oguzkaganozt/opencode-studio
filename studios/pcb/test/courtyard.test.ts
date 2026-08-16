import { describe, expect, test } from "bun:test"
import { measureComponentCourtyard } from "../courtyard"

describe("measureComponentCourtyard", () => {
  test("uses courtyard rect size", () => {
    expect(
      measureComponentCourtyard(
        [
          { type: "source_component", source_component_id: "sc1", name: "U_TEST" },
          { type: "pcb_component", pcb_component_id: "pc1", source_component_id: "sc1", center: { x: 0, y: 0 }, width: 4, height: 3 },
          { type: "pcb_courtyard_rect", pcb_component_id: "pc1", center: { x: 0, y: 0 }, width: 16.2, height: 18.4 },
        ],
        "U_TEST",
      ),
    ).toEqual({ widthMm: 16.2, heightMm: 18.4 })
  })

  test("falls back to pcb_component bbox when no courtyard exists", () => {
    expect(
      measureComponentCourtyard(
        [
          { type: "source_component", source_component_id: "sc1", name: "U_TEST" },
          { type: "pcb_component", pcb_component_id: "pc1", source_component_id: "sc1", center: { x: 2, y: -1 }, width: 2.4, height: 1.2 },
        ],
        "U_TEST",
      ),
    ).toEqual({ widthMm: 2.4, heightMm: 1.2 })
  })

  test("swaps rect axes at 90 degrees", () => {
    expect(
      measureComponentCourtyard(
        [
          { type: "source_component", source_component_id: "sc1", name: "U_TEST" },
          { type: "pcb_component", pcb_component_id: "pc1", source_component_id: "sc1", center: { x: 0, y: 0 }, width: 1, height: 1 },
          { type: "pcb_courtyard_rect", pcb_component_id: "pc1", center: { x: 0, y: 0 }, width: 10, height: 4, ccw_rotation: 90 },
        ],
        "U_TEST",
      ),
    ).toEqual({ widthMm: 4, heightMm: 10 })
  })

  test("unions polygon courtyard points", () => {
    expect(
      measureComponentCourtyard(
        [
          { type: "source_component", source_component_id: "sc1", name: "U_TEST" },
          { type: "pcb_component", pcb_component_id: "pc1", source_component_id: "sc1", center: { x: 0, y: 0 }, width: 1, height: 1 },
          {
            type: "pcb_courtyard_polygon",
            pcb_component_id: "pc1",
            points: [
              { x: -5, y: -2 },
              { x: 5, y: -2 },
              { x: 5, y: 3 },
              { x: -5, y: 3 },
            ],
          },
        ],
        "U_TEST",
      ),
    ).toEqual({ widthMm: 10, heightMm: 5 })
  })
})
