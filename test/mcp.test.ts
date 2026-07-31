import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { configureStudios, removeStudios } from "../src/lifecycle"

const packageRoot = path.resolve(import.meta.dir, "..")
const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function isolated() {
  const root = await mkdtemp(path.join(tmpdir(), "osc-mcp-"))
  temps.push(root)
  const workspace = path.join(root, "domain")
  await mkdir(workspace, { recursive: true })
  return {
    workspace,
    studioConfigHome: path.join(root, "studio-config"),
    openCodeHome: path.join(root, "opencode-config"),
    packageRoot,
  }
}

describe("CAD MCP management", () => {
  test("installs managed build123d and remove uninstalls it", async () => {
    const ctx = await isolated()
    await configureStudios({ ...ctx, validateOpenCode: false })
    const config = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    expect(config.mcp.build123d.type).toBe("local")
    expect(config.mcp.build123d.command.join(" ")).toContain("build123d-mcp@0.3.80")
    expect(config.mcp.build123d.command.join(" ")).toContain("mcp>=1.2,<2")
    expect(config.mcp.build123d.command[0]).toMatch(/uv/)

    await removeStudios({ ...ctx, validateOpenCode: false })
    const removed = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    expect(removed.mcp?.build123d).toBeUndefined()
  })

  test("refuses conflicting user MCP entry", async () => {
    const ctx = await isolated()
    await mkdir(ctx.openCodeHome, { recursive: true })
    await writeFile(
      path.join(ctx.openCodeHome, "opencode.json"),
      JSON.stringify({ mcp: { build123d: { type: "remote", url: "https://example.com" } } }, null, 2),
    )
    await expect(configureStudios({ ...ctx, validateOpenCode: false })).rejects.toThrow(/Conflict: mcp/)
  })
})
