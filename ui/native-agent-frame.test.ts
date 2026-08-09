import { describe, expect, test } from "bun:test"
import { shouldBindAgentDirectory } from "./native-agent-frame"

describe("NativeAgentFrame directory binding", () => {
  test("binds initially and when the directory changes, but not when a retained frame reopens", () => {
    expect(shouldBindAgentDirectory(false, undefined, "/studio")).toBe(true)
    expect(shouldBindAgentDirectory(true, "/studio", "/studio")).toBe(false)
    expect(shouldBindAgentDirectory(true, "/studio", "/other-project")).toBe(true)
  })
})
