import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

describe("OpenCode version alignment", () => {
  test("keeps the runtime floor, SDK, plugin, and prerequisite aligned", async () => {
    const root = path.resolve(import.meta.dir, "..")
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
    const version = manifest.dependencies["@opencode-ai/sdk"]
    expect(manifest.dependencies["@opencode-ai/plugin"]).toBe(version)
    expect(manifest.engines.opencode).toBe(`>=${version}`)
    expect(await readFile(path.join(root, "README.md"), "utf8")).toContain(`OpenCode](https://opencode.ai)** ≥ ${version}`)
  })
})
