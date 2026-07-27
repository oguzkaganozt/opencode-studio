import { describe, expect, test } from "bun:test"
import { bashCompletionScript, completionScript, isCompletionShell, zshCompletionScript } from "../src/completion"

describe("completion scripts", () => {
  test("accepts bash and zsh only", () => {
    expect(isCompletionShell("bash")).toBe(true)
    expect(isCompletionShell("zsh")).toBe(true)
    expect(isCompletionShell("fish")).toBe(false)
  })

  test("bash script completes core commands and service actions", () => {
    const script = bashCompletionScript()
    expect(script).toContain("complete -F _opencode_studio opencode-studio")
    expect(script).toContain("serve")
    expect(script).toContain("repair")
    expect(script).toContain("status")
    expect(script).toContain("service")
    expect(script).not.toContain("configure")
    expect(script).not.toContain("doctor")
  })

  test("zsh script registers compdef for opencode-studio", () => {
    const script = zshCompletionScript()
    expect(script).toContain("compdef _opencode_studio opencode-studio")
    expect(script).toContain("_arguments")
    expect(script).toContain("'repair'")
  })

  test("completionScript dispatches by shell", () => {
    expect(completionScript("bash")).toBe(bashCompletionScript())
    expect(completionScript("zsh")).toBe(zshCompletionScript())
  })
})
