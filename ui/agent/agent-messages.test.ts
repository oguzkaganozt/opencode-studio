import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { assistantBlocks } from "./agent-messages"

function toolPart(id: string): Part {
  return {
    id,
    type: "tool",
    tool: "bash",
    sessionID: "s",
    messageID: "m",
    callID: id,
    state: { status: "completed", input: { command: "ls" } },
  } as unknown as Part
}

function textPart(id: string, text: string): Part {
  return { id, type: "text", text, sessionID: "s", messageID: "m" } as unknown as Part
}

describe("assistantBlocks", () => {
  test("groups consecutive tools", () => {
    const blocks = assistantBlocks([toolPart("t1"), toolPart("t2")])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe("tools")
  })

  test("preserves text and tool chronology", () => {
    const blocks = assistantBlocks([textPart("x1", "before"), toolPart("t1"), textPart("x2", "after")])
    expect(blocks.map((block) => block.kind)).toEqual(["text", "tools", "text"])
  })
})
