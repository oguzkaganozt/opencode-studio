import { describe, expect, test } from "bun:test"
import { resolvePromptAgent } from "./resolve-prompt-agent"

describe("resolvePromptAgent", () => {
  test("routes each surface to its dedicated agent", () => {
    expect(resolvePromptAgent()).toBe("build")
    expect(resolvePromptAgent("cad")).toBe("studio-cad")
    expect(resolvePromptAgent("pcb")).toBe("studio-pcb")
    expect(resolvePromptAgent("media")).toBe("studio-media")
    expect(resolvePromptAgent("fw")).toBe("studio-fw")
  })
})
