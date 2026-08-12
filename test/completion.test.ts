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

  test("registers completion for the target shell", () => {
    const bash = bashCompletionScript("opencode-studio")
    expect(bash).toContain("complete -F _opencode_studio_completion opencode-studio")
    const zsh = zshCompletionScript("opencode-studio")
    expect(zsh).toContain("compdef _opencode_studio opencode-studio")
    // Sourced files must self-register; a bare invocation would error outside a completion context.
    expect(zsh.endsWith("compdef _opencode_studio opencode-studio\n")).toBe(true)
  })
})
