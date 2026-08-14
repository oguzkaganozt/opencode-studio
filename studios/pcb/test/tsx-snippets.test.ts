import { describe, expect, test } from "bun:test"
import { TSX_SNIPPET_KINDS, tsxSnippet } from "../tsx-snippets"

describe("tsx snippets", () => {
  test("every kind returns a tag and does not invent extra kinds", () => {
    expect(TSX_SNIPPET_KINDS).toEqual(["board", "resistor", "capacitor", "led", "pinheader", "chip", "trace"])
    expect(tsxSnippet("led")).toEqual({
      kind: "led",
      pins: ["anode", "cathode", "pin1", "pin2"],
      snippet: `<led name="D1" color="red" footprint="0603" />`,
    })
    expect(tsxSnippet("pinheader").snippet).toContain("pinCount={2}")
  })
})
