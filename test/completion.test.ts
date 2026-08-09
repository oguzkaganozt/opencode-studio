import { describe, expect, test } from "bun:test"
import { bashCompletionScript, zshCompletionScript } from "../src/completion"

describe("CLI completion", () => {
  test("includes the primary command and upgrade confirmation flags", () => {
    for (const script of [bashCompletionScript(), zshCompletionScript()]) {
      expect(script).toContain("up")
      expect(script).toContain("ensure-host")
      expect(script).toContain("--yes")
      expect(script).toContain("--version")
    }
  })
})
