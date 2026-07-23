import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { type CheckResult, assert, packReference, readJson, tempDir } from "../helpers"

export async function testPluginLoad(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const root = await tempDir("plugin-load")
  const packDir = path.join(root, "pack")
  const consumer = path.join(root, "consumer")
  await mkdir(consumer, { recursive: true })

  try {
    const tarball = await packReference(packDir)
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify(
        {
          name: "osc-consumer",
          private: true,
          type: "module",
        },
        null,
        2,
      ),
    )
    await $`bun add ${tarball}`.cwd(consumer)

    const manifest = await readJson<{ plugin: string }>(
      path.join(consumer, "node_modules/opencode-reference-studio/opencode-studio.json"),
    )
    assert(manifest.plugin === "./server", "packed manifest plugin")

    const pluginPath = path.join(consumer, "node_modules/opencode-reference-studio/dist/plugin.js")
    const mod = await import(pluginPath)
    assert(typeof mod.default === "function" || typeof mod.ReferenceStudioPlugin === "function", "plugin export")

    // Prove package export map resolves for the declared specifier shape.
    const pkg = await readJson<{ exports: Record<string, string> }>(
      path.join(consumer, "node_modules/opencode-reference-studio/package.json"),
    )
    assert(pkg.exports["./server"] === "./dist/plugin.js", "export map ./server")

    const resolved = await import(
      path.join(consumer, "node_modules/opencode-reference-studio", pkg.exports["./server"])
    )
    assert(typeof (resolved.default ?? resolved.ReferenceStudioPlugin) === "function", "resolved plugin")

    results.push({ name: "plugin.packed-specifier-load", ok: true })
  } catch (error) {
    results.push({
      name: "plugin.packed-specifier-load",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return results
}
