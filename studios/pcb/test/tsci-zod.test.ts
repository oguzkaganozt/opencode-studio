import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { engineCommand, resolveTsci } from "../../../src/core/engines"

const require = createRequire(import.meta.url)

describe("tsci zod 3 nest", () => {
  test("@tscircuit/props resolves the nested zod 3 shim", async () => {
    const resolved = require.resolve("zod", { paths: [path.dirname(require.resolve("@tscircuit/props"))] })
    expect(resolved).toContain(`${path.sep}@tscircuit${path.sep}node_modules${path.sep}zod`)
    const mod = (await import(pathToFileURL(resolved).href)) as { z: { function: () => { args: unknown } } }
    expect(typeof mod.z.function().args).toBe("function")
  })

  test("bundled tsci search no longer crashes on z.function().args", async () => {
    const engine = resolveTsci()
    expect(engine).not.toBeNull()
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pcb-tsci-zod-"))
    const proc = Bun.spawn([...engineCommand(engine!), "search", "--json", "0603"], { cwd, stdout: "pipe", stderr: "pipe" })
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    expect(stderr).not.toContain(".args is not a function")
    expect(exitCode === 0 || exitCode === 1).toBe(true)
  }, 30_000)
})
