import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  maybeMigrateLegacyConfig,
  parseStudioConfig,
  parseStudioConfigStrict,
  readStudioConfigFile,
  studioConfigPath,
  writeStudioConfigFile,
} from "../src/config"
import { STUDIO_IDS } from "../src/core/registry"

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
  test("empty object is valid", () => {
    const cfg = parseStudioConfig({})
    expect(cfg.roots).toBeUndefined()
    expect(cfg.warnings).toEqual([])
  })
  test("ignores legacy enabled with warning", () => {
    const cfg = parseStudioConfig({ enabled: ["cad", "pcb"] })
    expect(cfg.roots).toBeUndefined()
    expect(cfg.warnings.some((w) => w.includes("enabled"))).toBe(true)
  })
  test("rejects null", () => {
    expect(() => parseStudioConfig(null)).toThrow(/must be an object/)
  })
  test("rejects array", () => {
    expect(() => parseStudioConfig([])).toThrow(/must be an object/)
  })
  test("strips legacy roots without throwing", () => {
    const cfg = parseStudioConfig({ roots: { media: "/tmp/x" } })
    expect(cfg.roots).toBeUndefined()
    expect(cfg.warnings.some((w) => w.includes("roots.media"))).toBe(true)
  })
  test("accepts valid roots", () => {
    const cfg = parseStudioConfig({ roots: { cad: "/tmp/x" } })
    expect(cfg.roots?.cad).toBe(path.resolve("/tmp/x"))
  })
  test("strict parse rejects unknown root ids", () => {
    expect(() => parseStudioConfigStrict({ roots: { nope: "/tmp/x" } as any })).toThrow(/Unknown Studio ID/)
  })
})

describe("readStudioConfigFile", () => {
  test("missing file returns all studios always-on", async () => {
    const homes = await isolatedHome()
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual([...STUDIO_IDS])
    expect(result.error).toBeUndefined()
    expect(result.configPath).toBe(studioConfigPath(homes))
  })
  test("invalid JSON keeps domains on with error", async () => {
    const homes = await isolatedHome()
    await mkdir(homes.studioConfigHome, { recursive: true })
    await writeFile(studioConfigPath(homes), "{not json")
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual([...STUDIO_IDS])
    expect(result.error).toBeTruthy()
  })
  test("non-object JSON keeps domains on with error", async () => {
    const homes = await isolatedHome()
    await mkdir(homes.studioConfigHome, { recursive: true })
    await writeFile(studioConfigPath(homes), "[]")
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual([...STUDIO_IDS])
    expect(result.error).toBeTruthy()
  })
  test("legacy enabled is ignored; all studios on", async () => {
    const homes = await isolatedHome()
    await mkdir(homes.studioConfigHome, { recursive: true })
    await writeFile(studioConfigPath(homes), JSON.stringify({ enabled: ["cad"] }))
    const result = await readStudioConfigFile(homes)
    expect(result.enabled).toEqual([...STUDIO_IDS])
  })
})

describe("maybeMigrateLegacyConfig", () => {
  test("copies legacy roots into missing global home", async () => {
    const homes = await isolatedHome()
    const domain = path.join(homes.studioConfigHome, "domain")
    await mkdir(path.join(domain, ".opencode"), { recursive: true })
    await writeFile(path.join(domain, ".opencode", "studio.json"), JSON.stringify({ enabled: ["pcb"], roots: { pcb: "/tmp/pcb-root" } }))
    const result = await maybeMigrateLegacyConfig(domain, homes)
    expect(result.migrated).toBe(true)
    expect(result.config.enabled).toEqual([...STUDIO_IDS])
    expect(result.config.roots.pcb).toBe(path.resolve("/tmp/pcb-root"))
    const global = await readStudioConfigFile(homes)
    expect(global.roots.pcb).toBe(path.resolve("/tmp/pcb-root"))
  })

  test("does not migrate enablement-only legacy without roots", async () => {
    const homes = await isolatedHome()
    const domain = path.join(homes.studioConfigHome, "domain")
    await mkdir(path.join(domain, ".opencode"), { recursive: true })
    await writeFile(path.join(domain, ".opencode", "studio.json"), JSON.stringify({ enabled: ["pcb"] }))
    const result = await maybeMigrateLegacyConfig(domain, homes)
    expect(result.migrated).toBe(false)
  })

  test("does not overwrite existing global config", async () => {
    const homes = await isolatedHome()
    await writeStudioConfigFile({ roots: { cad: "/tmp/cad" } }, homes)
    const domain = path.join(homes.studioConfigHome, "domain")
    await mkdir(path.join(domain, ".opencode"), { recursive: true })
    await writeFile(path.join(domain, ".opencode", "studio.json"), JSON.stringify({ roots: { pcb: "/tmp/pcb" } }))
    const result = await maybeMigrateLegacyConfig(domain, homes)
    expect(result.migrated).toBe(false)
    expect(result.config.roots.cad).toBe(path.resolve("/tmp/cad"))
  })

  test("does not migrate when global file exists empty", async () => {
    const homes = await isolatedHome()
    await writeStudioConfigFile({}, homes)
    const domain = path.join(homes.studioConfigHome, "domain")
    await mkdir(path.join(domain, ".opencode"), { recursive: true })
    await writeFile(path.join(domain, ".opencode", "studio.json"), JSON.stringify({ roots: { pcb: "/tmp/pcb" } }))
    const result = await maybeMigrateLegacyConfig(domain, homes)
    expect(result.migrated).toBe(false)
  })
})
