import { describe, expect, test } from "bun:test"
import { AGENT_OPEN_KEY, readAgentOpen, writeAgentOpen } from "./agent-open"

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

describe("readAgentOpen", () => {
  test("absent key defaults closed", () => {
    expect(readAgentOpen(memoryStorage())).toBe(false)
  })

  test("true opens", () => {
    expect(readAgentOpen(memoryStorage({ [AGENT_OPEN_KEY]: "true" }))).toBe(true)
  })

  test("false stays closed", () => {
    expect(readAgentOpen(memoryStorage({ [AGENT_OPEN_KEY]: "false" }))).toBe(false)
  })

  test("write round-trip", () => {
    const storage = memoryStorage()
    writeAgentOpen(true, storage)
    expect(readAgentOpen(storage)).toBe(true)
    writeAgentOpen(false, storage)
    expect(readAgentOpen(storage)).toBe(false)
  })
})
