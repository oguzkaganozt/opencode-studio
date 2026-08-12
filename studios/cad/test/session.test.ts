import { describe, expect, test } from "bun:test"
import path from "node:path"
import { CadRuntimeSession } from "../tools/session"

const ENGINE_PROJECT_DIR = path.resolve(import.meta.dir, "..", "engine")

describe("build123d session recovery", () => {
  test("restarts after initialization abort and request timeout", async () => {
    const session = new CadRuntimeSession(ENGINE_PROJECT_DIR, process.cwd())
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 1)
      await expect(session.callTool("version", {}, { signal: controller.signal })).rejects.toThrow(/aborted/)

      const afterAbort = await session.callTool("version", {}, { timeoutMs: 60_000 })
      expect(afterAbort.isError).toBe(false)
      expect(afterAbort.text).toContain("forge-cad")
      expect(afterAbort.text).toMatch(/forge-cad: \d+\.\d+/)

      await expect(session.callTool("health_check", {}, { timeoutMs: 1 })).rejects.toThrow(/timed out/)

      const afterTimeout = await session.callTool("version", {}, { timeoutMs: 60_000 })
      expect(afterTimeout.isError).toBe(false)
      expect(afterTimeout.text).toContain("build123d: 0.11.1")
    } finally {
      await session.close()
    }
  }, 120_000)
})
