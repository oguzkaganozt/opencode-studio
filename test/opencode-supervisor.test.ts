import { afterEach, describe, expect, test } from "bun:test"
import { resetOpenCodeSupervisorForTests, restartOwnedOpenCode, superviseDisabled, supervisorStatus } from "../src/opencode-supervisor"

describe("superviseDisabled", () => {
  test("false by default", () => {
    expect(superviseDisabled({})).toBe(false)
  })

  test("true for common disable flags", () => {
    expect(superviseDisabled({ OPENCODE_STUDIO_NO_SUPERVISE: "1" })).toBe(true)
    expect(superviseDisabled({ OPENCODE_STUDIO_NO_SUPERVISE: "true" })).toBe(true)
    expect(superviseDisabled({ OPENCODE_STUDIO_NO_SUPERVISE: "off" })).toBe(false)
  })
})

describe("supervisor status / restart", () => {
  afterEach(() => {
    resetOpenCodeSupervisorForTests()
  })

  test("default status is unsupervised", () => {
    expect(supervisorStatus()).toEqual({
      supervised: false,
      pid: undefined,
      baseUrl: undefined,
      restartsInWindow: 0,
    })
  })

  test("restart fails when not supervised", async () => {
    const result = await restartOwnedOpenCode({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/not supervised/i)
  })
})
