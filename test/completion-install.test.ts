import { describe, expect, test } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  COMPLETION_MARKER,
  completionLine,
  ensureShellCompletions,
  preferredShells,
  rcAlreadyConfigured,
  shouldRunPostinstallCompletion,
} from "../src/completion-install"

describe("completion-install", () => {
  test("detects marker in rc content", () => {
    expect(rcAlreadyConfigured(`# ${COMPLETION_MARKER}\n${completionLine("bash")}\n`)).toBe(true)
    expect(rcAlreadyConfigured("export PATH=foo\n")).toBe(false)
  })

  test("postinstall only on global non-CI installs", () => {
    expect(shouldRunPostinstallCompletion({}).ok).toBe(false)
    expect(shouldRunPostinstallCompletion({ npm_config_global: "true" }).ok).toBe(true)
    expect(shouldRunPostinstallCompletion({ npm_config_global: "true", CI: "true" }).ok).toBe(false)
    expect(shouldRunPostinstallCompletion({ npm_config_global: "true", OPENCODE_STUDIO_SKIP_COMPLETION: "1" }).ok).toBe(false)
  })

  test("preferredShells follows $SHELL basename", () => {
    expect(preferredShells("/bin/zsh")).toEqual(["zsh"])
    expect(preferredShells("/usr/bin/bash")).toEqual(["bash"])
    expect(preferredShells("/bin/fish")).toEqual(["bash", "zsh"])
  })

  test("appends once to existing bashrc and zshrc", async () => {
    const home = path.join(tmpdir(), `osc-comp-${Date.now()}`)
    await mkdir(home, { recursive: true })
    const bashrc = path.join(home, ".bashrc")
    const zshrc = path.join(home, ".zshrc")
    await writeFile(bashrc, "# existing bash\n", "utf8")
    await writeFile(zshrc, "# existing zsh\n", "utf8")

    const first = await ensureShellCompletions({ home, shells: ["bash", "zsh"] })
    expect(first.skipped).toBe(false)
    expect(first.updated.sort()).toEqual([bashrc, zshrc].sort())
    expect(await readFile(bashrc, "utf8")).toContain(COMPLETION_MARKER)
    expect(await readFile(zshrc, "utf8")).toContain("completion zsh")

    const second = await ensureShellCompletions({ home, shells: ["bash", "zsh"] })
    expect(second.updated).toEqual([])
    expect(second.already.sort()).toEqual([bashrc, zshrc].sort())
  })

  test("respects shells filter from $SHELL preference", async () => {
    const home = path.join(tmpdir(), `osc-comp-shell-${Date.now()}`)
    await mkdir(home, { recursive: true })
    const bashrc = path.join(home, ".bashrc")
    const zshrc = path.join(home, ".zshrc")
    await writeFile(bashrc, "# bash\n", "utf8")
    await writeFile(zshrc, "# zsh\n", "utf8")
    const result = await ensureShellCompletions({ home, shells: ["bash"] })
    expect(result.updated).toEqual([bashrc])
    expect(await readFile(zshrc, "utf8")).not.toContain(COMPLETION_MARKER)
  })

  test("skips missing rc when onlyExisting", async () => {
    const home = path.join(tmpdir(), `osc-comp-empty-${Date.now()}`)
    await mkdir(home, { recursive: true })
    const result = await ensureShellCompletions({ home, onlyExisting: true, shells: ["bash", "zsh"] })
    expect(result.updated).toEqual([])
    expect(result.missing.length).toBe(2)
  })
})
