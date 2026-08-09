import { describe, expect, test } from "bun:test"
import { resolveAgentDirectory } from "../native-agent-url"

describe("resolveAgentDirectory", () => {
  test("prefers explicit project directory", () => {
    expect(resolveAgentDirectory("/proj/a", "/home/studio")).toBe("/proj/a")
  })

  test("falls back to studio root", () => {
    expect(resolveAgentDirectory(undefined, "/home/studio")).toBe("/home/studio")
    expect(resolveAgentDirectory("  ", "/home/studio")).toBe("/home/studio")
  })
})
