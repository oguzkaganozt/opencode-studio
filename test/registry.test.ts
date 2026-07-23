import { describe, expect, test } from "bun:test"
import { assertStudioIds, CATALOG_ORDER, isStudioId, STUDIO_IDS } from "../src/core/registry"
import { apiLoaders, assertLoaderCoverage, pluginLoaders } from "../src/studio-loaders"
import { assertCatalogComplete, listStudioDefinitions } from "../src/studios"

describe("registry", () => {
  test("catalog IDs are unique and complete", () => {
    expect(new Set(STUDIO_IDS).size).toBe(STUDIO_IDS.length)
    expect(CATALOG_ORDER).toEqual([...STUDIO_IDS])
    const defs = listStudioDefinitions()
    assertCatalogComplete(
      defs.map((d) => d.id),
      "definitions",
    )
  })

  test("unknown IDs are rejected", () => {
    expect(isStudioId("cad")).toBe(true)
    expect(isStudioId("nope")).toBe(false)
    expect(() => assertStudioIds(["cad", "nope"])).toThrow(/Unknown Studio ID/)
  })

  test("pluginLoaders and apiLoaders cover STUDIO_IDS / CATALOG_ORDER", () => {
    expect(() => assertLoaderCoverage()).not.toThrow()
    expect(Object.keys(pluginLoaders).sort()).toEqual([...STUDIO_IDS].sort())
    expect(Object.keys(apiLoaders).sort()).toEqual([...STUDIO_IDS].sort())
    for (const id of CATALOG_ORDER) {
      expect(typeof pluginLoaders[id]).toBe("function")
      expect(typeof apiLoaders[id]).toBe("function")
    }
  })
})
