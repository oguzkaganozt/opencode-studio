import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { assistantBlocks, isToolsOnly } from "./agent-messages"

function toolPart(id: string): Part {
  return { id, type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" } } } as Part
}

function textPart(id: string, text: string): Part {
  return { id, type: "text", text } as Part
}

describe("assistantBlocks / isToolsOnly", () => {
  test("groups consecutive tools and detects tools-only", () => {
    const blocks = assistantBlocks([toolPart("t1"), toolPart("t2")])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe("tools")
    expect(isToolsOnly(blocks)).toBe(true)
  })

  test("mixed tools + text is not tools-only", () => {
    const blocks = assistantBlocks([toolPart("t1"), textPart("x1", "hello")])
    expect(blocks.map((b) => b.kind)).toEqual(["tools", "text"])
    expect(isToolsOnly(blocks)).toBe(false)
  })

  test("text-only is not tools-only", () => {
    const blocks = assistantBlocks([textPart("x1", "hi")])
    expect(isToolsOnly(blocks)).toBe(false)
  })

  test("empty is not tools-only", () => {
    expect(isToolsOnly([])).toBe(false)
  })
})
