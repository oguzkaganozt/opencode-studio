import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { listComposedToolNames } from "../src/core/plugin-compose"
import { STUDIO_IDS } from "../src/core/registry"
import { configureStudios } from "../src/lifecycle"
import { createOpenCodeStudioPlugin } from "../src/plugin-factory"
import agentDigests from "./parity/agent-digests.json"
import hooks from "./parity/plugin-hooks.json"
import digests from "./parity/skill-digests.json"
import tools from "./parity/tools.json"

const packageRoot = path.join(import.meta.dir, "..")

describe("parity fixtures", () => {
  test("tool inventory is frozen", () => {
    expect(tools.count).toBe(Object.keys(tools.tools).length)
    expect(Object.keys(tools.tools).sort()).toContain("image_generate")
    expect(Object.keys(tools.tools).sort()).toContain("cad_design_build")
    expect(Object.keys(tools.tools).sort()).toContain("pcb_circuit_build")
  })

  test("skill and agent digests match every Studio source", async () => {
    const expected = STUDIO_IDS.map((id) => `studio-${id}`).sort()
    expect(Object.keys(digests).sort()).toEqual(expected)
    expect(Object.keys(agentDigests).sort()).toEqual(expected)
    const mismatches: string[] = []
    for (const fixture of [digests, agentDigests]) {
      for (const [_name, meta] of Object.entries(fixture as Record<string, { path: string; sha256: string }>)) {
        const file = path.join(packageRoot, meta.path)
        const hash = createHash("sha256")
          .update(await readFile(file))
          .digest("hex")
        if (hash !== meta.sha256) mismatches.push(`${meta.path}: fixture ${meta.sha256.slice(0, 12)}, source ${hash.slice(0, 12)}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  test("hook composition policy is defined", () => {
    expect(hooks.composition.order).toEqual(["cad", "pcb", "fw"])
    expect(hooks.platform).toContain("tool")
  })
})

describe("live tool inventory", () => {
  test("all Studios expose every parity tool name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-tools-"))
    try {
      const workspace = path.join(root, "domain")
      await mkdir(workspace, { recursive: true })
      const studioConfigHome = path.join(root, "studio-config")
      const openCodeHome = path.join(root, "opencode-config")
      await configureStudios({
        workspace,
        studioConfigHome,
        openCodeHome,
        packageRoot,
        validateOpenCode: false,
      })
      const plugin = createOpenCodeStudioPlugin({
        workspace,
        packageRoot,
        studioConfigHome,
        openCodeHome,
        ensureHost: false,
      })
      const composed = await plugin({ directory: workspace } as any, {})
      const names = listComposedToolNames(composed)
      for (const toolName of Object.keys(tools.tools)) {
        expect(names).toContain(toolName)
      }
      expect(names.length).toBe(tools.count)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  test("plugin always exposes domain tools without configure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-tools-always-"))
    try {
      const workspace = path.join(root, "domain")
      await mkdir(workspace, { recursive: true })
      const studioConfigHome = path.join(root, "studio-config")
      const openCodeHome = path.join(root, "opencode-config")
      const plugin = createOpenCodeStudioPlugin({
        workspace,
        packageRoot,
        studioConfigHome,
        openCodeHome,
        ensureHost: false,
      })
      const composed = await plugin({ directory: workspace } as any, {})
      const names = listComposedToolNames(composed)
      expect(names).toContain("image_generate")
      expect(names).toContain("cad_design_build")
      expect(names).toContain("pcb_circuit_build")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
