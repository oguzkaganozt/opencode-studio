import { readFile } from "node:fs/promises"
import path from "node:path"
import { type CheckResult, REFERENCE_ROOT, SCHEMA_PATH, assert, readJson } from "../helpers"

function validateManifest(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Manifest must be an object")
  const manifest = value as Record<string, unknown>
  const required = ["schemaVersion", "id", "contractVersion", "minimumOpenCode", "plugin", "skill"]
  for (const key of required) {
    if (!(key in manifest)) throw new Error(`Manifest missing required field: ${key}`)
  }
  for (const key of Object.keys(manifest)) {
    if (!required.includes(key)) throw new Error(`Manifest has unknown field: ${key}`)
  }
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be 1")
  if (typeof manifest.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(manifest.id)) {
    throw new Error("Invalid manifest id")
  }
  if (typeof manifest.plugin !== "string" || !manifest.plugin) throw new Error("Invalid plugin")
  if (typeof manifest.skill !== "string" || !/^\.\.?\/.*/.test(manifest.skill)) {
    throw new Error("Invalid skill path")
  }
}

export async function testManifest(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const schema = await readJson<Record<string, unknown>>(SCHEMA_PATH)
  const manifest = await readJson<unknown>(path.join(REFERENCE_ROOT, "opencode-studio.json"))

  try {
    assert(schema.title === "OpenCode Studio Manifest", "schema title mismatch")
    validateManifest(manifest)
    results.push({ name: "manifest.validates", ok: true })
  } catch (error) {
    results.push({
      name: "manifest.validates",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const pkg = await readJson<{ name: string; exports: Record<string, string>; bin: Record<string, string> }>(
      path.join(REFERENCE_ROOT, "package.json"),
    )
    assert(pkg.name === "opencode-reference-studio", "package name")
    assert(pkg.bin["opencode-reference-studio"], "cli bin missing")
    assert(pkg.exports["./server"] === "./dist/plugin.js", "plugin export path")
    const m = manifest as { plugin: string; skill: string; id: string }
    assert(m.plugin === "./server", "manifest plugin specifier")
    assert(m.skill === "./skills/reference-studio", "manifest skill path")
    assert(m.id === "reference", "manifest id")
    const skill = await readFile(path.join(REFERENCE_ROOT, "skills/reference-studio/SKILL.md"), "utf8")
    assert(skill.includes("name: reference-studio"), "skill frontmatter")
    results.push({ name: "manifest.package-alignment", ok: true })
  } catch (error) {
    results.push({
      name: "manifest.package-alignment",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return results
}
