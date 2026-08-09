import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { opencodeWrapperPath, opencodeWrapperScript, removeOpencodeServeWrapper } from "../src/opencode-wrapper"

describe("opencode wrapper removal", () => {
  let home = ""

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true })
    home = ""
  })

  test("removes marker-matched wrapper only", async () => {
    home = await mkdtemp(path.join(tmpdir(), "osc-wrap-"))
    const target = opencodeWrapperPath(home)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, opencodeWrapperScript(), { mode: 0o755 })

    const removed = await removeOpencodeServeWrapper(home)
    expect(removed.removed).toBe(true)
    expect(await Bun.file(target).exists()).toBe(false)
  })

  test("leaves foreign binaries alone", async () => {
    home = await mkdtemp(path.join(tmpdir(), "osc-wrap-"))
    const target = opencodeWrapperPath(home)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, "#!/bin/sh\necho real-opencode\n", { mode: 0o755 })

    const removed = await removeOpencodeServeWrapper(home)
    expect(removed.removed).toBe(false)
    expect(await readFile(target, "utf8")).toContain("real-opencode")
  })
})
