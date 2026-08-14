import { describe, expect, test } from "bun:test"
import { resolvePromptAgent } from "./resolve-prompt-agent"

describe("resolvePromptAgent", () => {
  test("routes each surface to its dedicated agent", () => {
    expect(resolvePromptAgent()).toBe("build")
    expect(resolvePromptAgent("concept")).toBe("concept")
    expect(resolvePromptAgent("cad")).toBe("cad")
    expect(resolvePromptAgent("pcb")).toBe("pcb")
    expect(resolvePromptAgent("fw")).toBe("firmware")
  })
})
