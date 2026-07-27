import { describe, expect, test } from "bun:test"
import {
  AGENT_WIDTH_DEFAULT,
  AGENT_WIDTH_KEY,
  AGENT_WIDTH_MAX,
  AGENT_WIDTH_MIN,
  clampAgentWidth,
  readAgentWidth,
  viewportAgentWidthMax,
  writeAgentWidth,
} from "./agent-width"

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

describe("clampAgentWidth", () => {
  test("clamps to bounds", () => {
    expect(clampAgentWidth(100)).toBe(AGENT_WIDTH_MIN)
    expect(clampAgentWidth(900)).toBe(AGENT_WIDTH_MAX)
    expect(clampAgentWidth(400)).toBe(400)
  })

  test("respects viewport max", () => {
    expect(viewportAgentWidthMax(400)).toBe(360)
    expect(clampAgentWidth(500, 400)).toBe(360)
  })

  test("non-finite falls back to default", () => {
    expect(clampAgentWidth(Number.NaN)).toBe(AGENT_WIDTH_DEFAULT)
  })
})

describe("readAgentWidth / writeAgentWidth", () => {
  test("defaults when absent", () => {
    expect(readAgentWidth(memoryStorage())).toBe(AGENT_WIDTH_DEFAULT)
  })

  test("round-trip", () => {
    const storage = memoryStorage()
    writeAgentWidth(500, storage)
    expect(storage.getItem(AGENT_WIDTH_KEY)).toBe("500")
    expect(readAgentWidth(storage)).toBe(500)
  })
})
