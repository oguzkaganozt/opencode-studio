import { describe, expect, test } from "bun:test"
import { deriveAgentStatus } from "./agent-status"

describe("deriveAgentStatus", () => {
  test("closed when panel closed", () => {
    expect(deriveAgentStatus({ open: false, available: true, loading: true, error: true })).toBe("closed")
  })

  test("unavailable when native OpenCode is off", () => {
    expect(deriveAgentStatus({ open: true, available: false, loading: false, error: false })).toBe("unavailable")
  })

  test("error when iframe failed", () => {
    expect(deriveAgentStatus({ open: true, available: true, loading: false, error: true })).toBe("error")
  })

  test("loading while frame settles", () => {
    expect(deriveAgentStatus({ open: true, available: true, loading: true, error: false })).toBe("loading")
  })

  test("ready when open and settled", () => {
    expect(deriveAgentStatus({ open: true, available: true, loading: false, error: false })).toBe("ready")
  })
})
