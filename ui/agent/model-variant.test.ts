import { describe, expect, test } from "bun:test"
import { availableModelVariants, modelVariantLabel } from "./model-variant"

describe("model variants", () => {
  test("returns enabled variants in reasoning-effort order", () => {
    expect(availableModelVariants({ max: {}, low: {}, custom: {}, medium: {}, none: {}, xhigh: {}, disabled: { disabled: true } })).toEqual(
      ["none", "low", "medium", "xhigh", "max", "custom"],
    )
  })

  test("formats compact labels", () => {
    expect(modelVariantLabel("medium")).toBe("Medium")
    expect(modelVariantLabel("xhigh")).toBe("X-high")
    expect(modelVariantLabel("")).toBe("Default")
  })
})
