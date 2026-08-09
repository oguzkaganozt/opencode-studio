import { afterEach, describe, expect, test } from "bun:test"
import {
  ensureOpenCodeServer,
  resetOpenCodeSupervisorForTests,
  restartOwnedOpenCode,
  superviseDisabled,
  supervisedChildEnv,
  supervisorStatus,
} from "../src/opencode-supervisor"

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
  afterEach(async () => {
    await resetOpenCodeSupervisorForTests()
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

  test("supervised child cannot autostart a competing Studio host", () => {
    expect(supervisedChildEnv("http://127.0.0.1:4096", { HOME: "/home/test" })).toMatchObject({
      OPENCODE_STUDIO_AUTOSTART: "0",
      OPENCODE_STUDIO_URL: "http://127.0.0.1:4173",
    })
  })

  test("an unhealthy explicit URL fails instead of spawning a fallback", async () => {
    const result = await ensureOpenCodeServer({
      OPENCODE_URL: "http://127.0.0.1:65534",
      OPENCODE_BIN: "/definitely/missing/opencode",
    })
    expect(result).toEqual({ ok: false, reason: "OPENCODE_URL not healthy: http://127.0.0.1:65534" })
  })

  test("a missing binary returns a controlled startup failure", async () => {
    const started = Date.now()
    const result = await ensureOpenCodeServer({
      OPENCODE_PORT: "65534",
      OPENCODE_BIN: "/definitely/missing/opencode",
      XDG_CACHE_HOME: "/tmp/opencode-studio-supervisor-test",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/ENOENT|no such file/i)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
