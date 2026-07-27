import { describe, expect, test } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  COMPLETION_MARKER,
  completionLine,
  ensureShellCompletions,
  migrateLegacyCompletionRc,
  preferredShells,
  rcHasCurrentCompletion,
  rcHasLegacyCompletion,
  shouldRunPostinstallCompletion,
} from "../src/completion-install"

describe("completion-install", () => {
  test("detects current source form", () => {
    const home = "/tmp/home"
    const line = completionLine("bash", home)
    expect(rcHasCurrentCompletion(`# header\n${line}\n`, "bash", home)).toBe(true)
    expect(rcHasCurrentCompletion("export PATH=foo\n", "bash", home)).toBe(false)
  })

  test("detects legacy eval form", () => {
    expect(rcHasLegacyCompletion(`eval "$(opencode-studio completion bash)"  # ${COMPLETION_MARKER}\n`)).toBe(true)
    expect(rcHasLegacyCompletion(completionLine("bash", "/tmp/h"))).toBe(false)
  })

  test("migrates legacy eval line to source form", () => {
    const home = "/home/me"
    const old = `# stuff\neval "$(opencode-studio completion bash)"  # ${COMPLETION_MARKER}\n# more\n`
    const next = migrateLegacyCompletionRc(old, "bash", home)
    expect(next).toContain(completionLine("bash", home))
    expect(next).not.toContain("opencode-studio completion")
    expect(rcHasLegacyCompletion(next)).toBe(false)
    expect(rcHasCurrentCompletion(next, "bash", home)).toBe(true)
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
    expect(await readFile(zshrc, "utf8")).toContain("completion.zsh")
    expect(await Bun.file(path.join(home, ".config/opencode-studio/completion.bash")).exists()).toBe(true)

    const second = await ensureShellCompletions({ home, shells: ["bash", "zsh"] })
    expect(second.updated).toEqual([])
    expect(second.migrated).toEqual([])
    expect(second.already.sort()).toEqual([bashrc, zshrc].sort())
  })

  test("rewrites legacy eval rc on upgrade", async () => {
    const home = path.join(tmpdir(), `osc-comp-legacy-${Date.now()}`)
    await mkdir(home, { recursive: true })
    const bashrc = path.join(home, ".bashrc")
    await writeFile(bashrc, `# existing\neval "$(opencode-studio completion bash)"  # ${COMPLETION_MARKER}\nexport FOO=1\n`, "utf8")

    const result = await ensureShellCompletions({ home, shells: ["bash"] })
    expect(result.migrated).toEqual([bashrc])
    const body = await readFile(bashrc, "utf8")
    expect(body).toContain(completionLine("bash", home))
    expect(body).not.toContain("opencode-studio completion")
    expect(body).toContain("export FOO=1")

    const again = await ensureShellCompletions({ home, shells: ["bash"] })
    expect(again.migrated).toEqual([])
    expect(again.already).toEqual([bashrc])
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
