import { describe, expect, test } from "bun:test"
import { normalizeAgentFilePath } from "./use-viewer-refresh"

describe("Agent viewer refresh paths", () => {
  test("resolves session-relative paths against the event directory", () => {
    expect(normalizeAgentFilePath("./build/model.glb", "/studio/designs/case/")).toBe("/studio/designs/case/build/model.glb")
  })

  test("preserves absolute paths and normalizes separators", () => {
    expect(normalizeAgentFilePath("/studio/circuits/board/circuit.json", "/other")).toBe("/studio/circuits/board/circuit.json")
    expect(normalizeAgentFilePath("C:\\studio\\board\\circuit.json", "C:\\other")).toBe("C:/studio/board/circuit.json")
  })
})
