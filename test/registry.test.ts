import { describe, expect, test } from "bun:test"
import { assertCatalogComplete, isStudioId, STUDIO_IDS } from "../src/core/registry"
import { apiLoaders, assertLoaderCoverage, pluginLoaders } from "../src/studio-loaders"
import { listStudioDefinitions } from "../src/studios"

describe("registry", () => {
  test("catalog IDs are unique and complete", () => {
    expect(new Set(STUDIO_IDS).size).toBe(STUDIO_IDS.length)
    const defs = listStudioDefinitions()
    assertCatalogComplete(
      defs.map((d) => d.id),
      "definitions",
    )
  })

  test("unknown IDs are rejected", () => {
    expect(isStudioId("cad")).toBe(true)
    expect(isStudioId("nope")).toBe(false)
  })

  test("pluginLoaders and apiLoaders cover STUDIO_IDS", () => {
    expect(() => assertLoaderCoverage()).not.toThrow()
    expect(Object.keys(pluginLoaders).sort()).toEqual([...STUDIO_IDS].sort())
    expect(Object.keys(apiLoaders).sort()).toEqual([...STUDIO_IDS].sort())
    for (const id of STUDIO_IDS) {
      expect(typeof pluginLoaders[id]).toBe("function")
      expect(typeof apiLoaders[id]).toBe("function")
    }
  })
})
