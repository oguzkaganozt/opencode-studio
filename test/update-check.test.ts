import { describe, expect, test } from "bun:test"
import { checkNpmUpdate, isVersionNewer } from "../src/core/update-check"

describe("update check", () => {
  test("isVersionNewer compares dotted versions", () => {
    expect(isVersionNewer("0.2.2", "0.2.1")).toBe(true)
    expect(isVersionNewer("0.2.1", "0.2.2")).toBe(false)
    expect(isVersionNewer("0.2.1", "0.2.1")).toBe(false)
    expect(isVersionNewer("1.0.0", "0.9.9")).toBe(true)
  })

  test("checkNpmUpdate uses registry payload", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    const info = await checkNpmUpdate({
      packageName: "@oguzkaganozt/opencode-studio",
      current: "0.2.2",
      ttlMs: 1,
      fetchImpl,
    })
    expect(info.updateAvailable).toBe(true)
    expect(info.latest).toBe("9.9.9")
    expect(info.message).toContain("9.9.9")
  })
})
