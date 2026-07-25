import { describe, expect, test } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { main } from "../src/cli"
import { bashCompletionScript, completionScript, isCompletionShell, zshCompletionScript } from "../src/completion"
import { STUDIO_IDS } from "../src/core/registry"

describe("completion", () => {
  test("accepts bash and zsh only", () => {
    expect(isCompletionShell("bash")).toBe(true)
    expect(isCompletionShell("zsh")).toBe(true)
    expect(isCompletionShell("fish")).toBe(false)
  })

  test("bash script completes commands, studios, and service actions", () => {
    const script = bashCompletionScript()
    expect(script).toContain("complete -F _opencode_studio opencode-studio")
    expect(script).toContain("configure")
    expect(script).toContain("service")
    expect(script).toContain("install")
    for (const id of STUDIO_IDS) expect(script).toContain(id)
  })

  test("zsh script registers compdef for opencode-studio", () => {
    const script = zshCompletionScript()
    expect(script).toContain("compdef _opencode_studio opencode-studio")
    expect(script).toContain("_arguments")
    for (const id of STUDIO_IDS) expect(script).toContain(`'${id}'`)
  })

  test("completionScript dispatches by shell", () => {
    expect(completionScript("bash")).toBe(bashCompletionScript())
    expect(completionScript("zsh")).toBe(zshCompletionScript())
  })

  test("cli completion bash prints script to stdout", async () => {
    const chunks: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
      return true
    }) as typeof process.stdout.write
    try {
      const code = await main(["completion", "bash"])
      expect(code).toBe(0)
      expect(chunks.join("")).toContain("complete -F _opencode_studio opencode-studio")
    } finally {
      process.stdout.write = write
    }
  })

  test("cli completion rejects unknown shell", async () => {
    const code = await main(["completion", "fish"])
    expect(code).toBe(2)
  })

  test("cli completion install is quiet-safe", async () => {
    const home = path.join(tmpdir(), `osc-cli-comp-${Date.now()}`)
    await mkdir(home, { recursive: true })
    await writeFile(path.join(home, ".bashrc"), "# test\n", "utf8")
    const prev = process.env.OPENCODE_STUDIO_COMPLETION_HOME
    process.env.OPENCODE_STUDIO_COMPLETION_HOME = home
    try {
      const code = await main(["completion", "install", "--quiet"])
      expect(code).toBe(0)
      const bashrc = await readFile(path.join(home, ".bashrc"), "utf8")
      expect(bashrc).toContain("opencode-studio completion bash")
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_STUDIO_COMPLETION_HOME
      else process.env.OPENCODE_STUDIO_COMPLETION_HOME = prev
    }
  })
})
