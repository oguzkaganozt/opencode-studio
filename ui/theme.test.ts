import { describe, expect, test } from "bun:test"
import { resolveTheme, type ThemePreference } from "./theme"

describe("resolveTheme", () => {
  const cases: Array<[ThemePreference, boolean, "light" | "dark"]> = [
    ["light", true, "light"],
    ["light", false, "light"],
    ["dark", true, "dark"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
  ]

  for (const [preference, prefersDark, expected] of cases) {
    test(`${preference} + prefersDark=${prefersDark} → ${expected}`, () => {
      expect(resolveTheme(preference, prefersDark)).toBe(expected)
    })
  }
})
