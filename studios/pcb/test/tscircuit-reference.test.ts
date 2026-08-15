import { describe, expect, test } from "bun:test"
import { lookupTscircuitReference, TSCIRCUIT_REFERENCE_METADATA } from "../tscircuit-reference"

describe("pinned tscircuit reference", () => {
  test("returns exact official reference data with immutable source metadata", () => {
    const result = lookupTscircuitReference("<resistor />")

    expect(result.status).toBe("exact")
    expect(result.matchedBy).toBe("id")
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.path).toBe("elements/resistor.md")
    expect(result.matches[0]?.content).toContain("# `<resistor />`")
    expect(result.metadata).toEqual(TSCIRCUIT_REFERENCE_METADATA)
    expect(result.metadata).toMatchObject({
      authority: "official",
      usage: "reference-only",
      commit: "3dbfeec2d2c9d2dafa3358376bae8676fff379c7",
      tscircuitVersion: "0.0.2306",
      networkAccess: false,
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  test("resolves aliases and applies the runtime keepout compatibility override", () => {
    const result = lookupTscircuitReference("pcbkeepout")

    expect(result.status).toBe("exact")
    expect(result.matchedBy).toBe("alias")
    expect(result.matches[0]?.id).toBe("keepout")
    expect(result.matches[0]?.content).toContain("<pcbkeepout")
    expect(result.warnings).toEqual([expect.stringContaining("<keepout />")])
  })

  test("adds a readiness warning to USB-C aliases", () => {
    const result = lookupTscircuitReference("USB-C")

    expect(result.status).toBe("exact")
    expect(result.matches[0]?.id).toBe("connector")
    expect(result.warnings).toEqual([expect.stringContaining("not a readiness guarantee")])
  })

  test("returns deterministic bounded ambiguous matches", () => {
    const first = lookupTscircuitReference("pcb")
    const second = lookupTscircuitReference("pcb")

    expect(first.status).toBe("ambiguous")
    expect(first).toEqual(second)
    expect(first.matches.length).toBeGreaterThan(1)
    expect(first.matches.length).toBeLessThanOrEqual(5)
    expect(first.matches.every((match) => match.content.length <= 12_000)).toBe(true)
  })

  test("rejects empty and oversized queries and reports misses", () => {
    expect(lookupTscircuitReference("   ").status).toBe("invalid")
    expect(lookupTscircuitReference("x".repeat(101)).status).toBe("invalid")
    expect(lookupTscircuitReference("definitely absent").status).toBe("not_found")
  })
})
