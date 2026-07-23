import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { maybeMigrateLegacyConfig, parseStudioConfig, readStudioConfigFile, studioConfigPath, writeStudioConfigFile } from "../src/config"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function isolatedHome() {
  const dir = await mkdtemp(path.join(tmpdir(), "osc-cfg-"))
  temps.push(dir)
  return { studioConfigHome: dir }
}

describe("parseStudioConfig", () => {
  test("valid enabled", () => {
    expect(parseStudioConfig({ enabled: ["cad", "pcb"] }).enabled).toEqual(["cad", "pcb"])
  })
  test("rejects null", () => {
    expect(() => parseStudioConfig(null)).toThrow(/must be an object/)
  })
  test("rejects array", () => {
    expect(() => parseStudioConfig([])).toThrow(/must be an object/)
  })
  test("rejects non-array enabled", () => {
    expect(() => parseStudioConfig({ enabled: "cad" })).toThrow(/array of Studio IDs/)
  })
  test("rejects unknown IDs", () => {
    expect(() => parseStudioConfig({ enabled: ["nope"] })).toThrow(/Unknown Studio ID/)
  })
  test("dedupes IDs", () => {
    expect(parseStudioConfig({ enabled: ["cad", "cad"] }).enabled).toEqual(["cad"])
  })
  test("rejects relative roots", () => {
    expect(() => parseStudioConfig({ enabled: ["cad"], roots: { media: "relative" } })).toThrow(/absolute path/)
  })
  test("rejects empty roots", () => {
    expect(() => parseStudioConfig({ enabled: ["cad"], roots: { media: "" } })).toThrow(/absolute path/)
  })
  test("rejects null byte in roots", () => {
    expect(() => parseStudioConfig({ enabled: ["cad"], roots: { media: "/tmp/foo\0bar" } })).toThrow(/absolute path/)
  })
  test("rejects unknown root keys", () => {
    expect(() => parseStudioConfig({ enabled: ["cad"], roots: { nope: "/tmp/x" } })).toThrow(/Unknown Studio ID/)
  })
  test("accepts valid roots", () => {
    const cfg = parseStudioConfig({ enabled: ["cad"], roots: { media: "/tmp/x" } })
    expect(cfg.roots?.media).toBe(path.resolve("/tmp/x"))
  })
})

describe("readStudioConfigFile", () => {
  test("missing file returns empty enabled (fail-closed)", async () => {
    const homes = await isolatedHome()
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual([])
    expect(result.error).toBeUndefined()
    expect(result.configPath).toBe(studioConfigPath(homes))
  })
  test("invalid JSON returns empty enabled with error (fail-closed)", async () => {
    const homes = await isolatedHome()
    await mkdir(homes.studioConfigHome, { recursive: true })
    await writeFile(studioConfigPath(homes), "{not json")
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual([])
    expect(result.error).toBeTruthy()
  })
  test("non-object JSON returns empty enabled with error", async () => {
    const homes = await isolatedHome()
    await mkdir(homes.studioConfigHome, { recursive: true })
    await writeFile(studioConfigPath(homes), "[]")
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual([])
    expect(result.error).toBeTruthy()
  })
  test("valid config reads enabled", async () => {
    const homes = await isolatedHome()
    await mkdir(homes.studioConfigHome, { recursive: true })
    await writeFile(studioConfigPath(homes), JSON.stringify({ enabled: ["cad", "startup"] }))
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual(["cad", "startup"])
  })
})

describe("maybeMigrateLegacyConfig", () => {
  test("copies legacy project config into empty global home", async () => {
    const homes = await isolatedHome()
    const domain = path.join(homes.studioConfigHome, "domain")
    await mkdir(path.join(domain, ".opencode"), { recursive: true })
    await writeFile(path.join(domain, ".opencode", "studio.json"), JSON.stringify({ enabled: ["pcb"] }))
    const result = await maybeMigrateLegacyConfig(domain, homes)
    expect(result.migrated).toBe(true)
    expect(result.config.enabled).toEqual(["pcb"])
    const global = await readStudioConfigFile(homes)
    expect(global.enabled).toEqual(["pcb"])
  })

  test("does not overwrite existing global config", async () => {
    const homes = await isolatedHome()
    await writeStudioConfigFile({ enabled: ["cad"] }, homes)
    const domain = path.join(homes.studioConfigHome, "domain")
    await mkdir(path.join(domain, ".opencode"), { recursive: true })
    await writeFile(path.join(domain, ".opencode", "studio.json"), JSON.stringify({ enabled: ["pcb"] }))
    const result = await maybeMigrateLegacyConfig(domain, homes)
    expect(result.migrated).toBe(false)
    expect(result.config.enabled).toEqual(["cad"])
  })

  test("does not migrate when global file exists with empty enabled", async () => {
    const homes = await isolatedHome()
    await writeStudioConfigFile({ enabled: [] }, homes)
    const domain = path.join(homes.studioConfigHome, "domain")
    await mkdir(path.join(domain, ".opencode"), { recursive: true })
    await writeFile(path.join(domain, ".opencode", "studio.json"), JSON.stringify({ enabled: ["pcb"] }))
    const result = await maybeMigrateLegacyConfig(domain, homes)
    expect(result.migrated).toBe(false)
    expect(result.config.enabled).toEqual([])
  })
})
