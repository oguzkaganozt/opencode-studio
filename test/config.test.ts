import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseStudioConfig, readStudioConfigFile, studioConfigPath } from "../src/config"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

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
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-cfg-"))
    temps.push(workspace)
    const result = await readStudioConfigFile(workspace)
    expect(result.enabled).toEqual([])
    expect(result.error).toBeUndefined()
  })
  test("invalid JSON returns empty enabled with error (fail-closed)", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-cfg-"))
    temps.push(workspace)
    await mkdir(path.dirname(studioConfigPath(workspace)), { recursive: true })
    await writeFile(studioConfigPath(workspace), "{not json")
    const result = await readStudioConfigFile(workspace)
    expect(result.enabled).toEqual([])
    expect(result.error).toBeTruthy()
  })
  test("non-object JSON returns empty enabled with error", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-cfg-"))
    temps.push(workspace)
    await mkdir(path.dirname(studioConfigPath(workspace)), { recursive: true })
    await writeFile(studioConfigPath(workspace), "[]")
    const result = await readStudioConfigFile(workspace)
    expect(result.enabled).toEqual([])
    expect(result.error).toBeTruthy()
  })
  test("valid config reads enabled", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-cfg-"))
    temps.push(workspace)
    await mkdir(path.dirname(studioConfigPath(workspace)), { recursive: true })
    await writeFile(studioConfigPath(workspace), JSON.stringify({ enabled: ["cad", "startup"] }))
    const result = await readStudioConfigFile(workspace)
    expect(result.enabled).toEqual(["cad", "startup"])
  })
})
