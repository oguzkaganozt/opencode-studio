import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { summarizePart, toolPreview } from "./part-text"

const part = (value: unknown) => value as Part

describe("agent part text", () => {
  test("hides internal step markers", () => {
    expect(summarizePart(part({ type: "step-start" }))).toBeUndefined()
    expect(summarizePart(part({ type: "step-finish" }))).toBeUndefined()
    expect(summarizePart(part({ type: "snapshot" }))).toBeUndefined()
  })

  test("summarizes meaningful fallback parts", () => {
    expect(summarizePart(part({ type: "patch", files: ["a.ts", "b.ts"] }))).toBe("2 files updated")
    expect(summarizePart(part({ type: "subtask", description: "Inspect routes" }))).toBe("Inspect routes")
  })

  test("uses the first command line as a compact tool preview", () => {
    expect(
      toolPreview(
        part({
          type: "tool",
          tool: "bash",
          state: { input: { command: "bun run check\nsecond line" } },
        }),
      ),
    ).toBe("bun run check")
  })
})
