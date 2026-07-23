import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { configureStudios } from "../src/lifecycle"

const packageRoot = path.resolve(import.meta.dir, "..")
const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("CAD MCP management", () => {
  test("enables and removes managed build123d entry", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-mcp-"))
    temps.push(workspace)
    await configureStudios({ workspace, enabled: ["cad"], packageRoot, validateOpenCode: false })
    const config = JSON.parse(await readFile(path.join(workspace, "opencode.json"), "utf8"))
    expect(config.mcp.build123d.type).toBe("local")
    expect(config.mcp.build123d.command.join(" ")).toContain("build123d-mcp@0.3.77")

    await configureStudios({ workspace, enabled: [], packageRoot, validateOpenCode: false })
    const removed = JSON.parse(await readFile(path.join(workspace, "opencode.json"), "utf8"))
    expect(removed.mcp?.build123d).toBeUndefined()
  })

  test("refuses conflicting user MCP entry", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-mcp-"))
    temps.push(workspace)
    await writeFile(
      path.join(workspace, "opencode.json"),
      JSON.stringify({ mcp: { build123d: { type: "remote", url: "https://example.com" } } }, null, 2),
    )
    await expect(configureStudios({ workspace, enabled: ["cad"], packageRoot, validateOpenCode: false })).rejects.toThrow(/Conflict: mcp/)
  })
})
