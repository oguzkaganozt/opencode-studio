import { describe, expect, test } from "bun:test"
import { deriveAgentStatus } from "./agent-status"

describe("deriveAgentStatus", () => {
  test("closed when panel closed", () => {
    expect(deriveAgentStatus({ open: false, sessionsPending: true, queryError: { status: 500 } })).toBe("closed")
  })

  test("needs-password on 401", () => {
    expect(deriveAgentStatus({ open: true, sessionsPending: false, queryError: { status: 401 } })).toBe("needs-password")
  })

  test("setup on chat_auth_required", () => {
    expect(deriveAgentStatus({ open: true, sessionsPending: false, queryError: { code: "chat_auth_required" } })).toBe("setup")
  })

  test("error on other failures", () => {
    expect(deriveAgentStatus({ open: true, sessionsPending: false, queryError: { status: 500 } })).toBe("error")
  })

  test("loading while sessions pending", () => {
    expect(deriveAgentStatus({ open: true, sessionsPending: true, queryError: null })).toBe("loading")
  })

  test("ready when open and settled", () => {
    expect(deriveAgentStatus({ open: true, sessionsPending: false, queryError: null })).toBe("ready")
  })
})
