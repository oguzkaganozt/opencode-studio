import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readStudioConfigFile } from "../src/config"
import { createOpenCodeStudioPlugin } from "../src/plugin-factory"

const packageRoot = path.resolve(import.meta.dir, "..")
const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("Studio plugin roots", () => {
  test("CAD and PCB use fixed Studio Home instead of the OpenCode project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-plugin-root-"))
    temps.push(root)
    const studioRoot = path.join(root, "home")
    const project = path.join(root, "project")
    await Promise.all([mkdir(studioRoot), mkdir(project)])

    const plugin = createOpenCodeStudioPlugin({
      studioRoot,
      workspace: project,
      packageRoot,
      studioConfigHome: path.join(root, "studio-config"),
      openCodeHome: path.join(root, "opencode-config"),
      ensureHost: false,
    })
    const hooks = await plugin({ directory: project } as any, {})
    const tools = hooks.tool as any

    await tools.design_create.execute({ id: "home-design", parts: [{ id: "body" }] }, { ask: async () => {} })
    expect(await Bun.file(path.join(studioRoot, "studio", "designs", "home-design", "design.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(project, "designs", "home-design", "design.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(studioRoot, "designs", "home-design", "design.json")).exists()).toBe(false)

    const pcb = JSON.parse(await tools.pcb_workspace_list.execute({}, {}))
    expect(pcb.workspaceRoot).toBe(path.join(studioRoot, "studio", "circuits"))
  }, 60_000)

  test("migrates legacy project roots without making the project Studio Home", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-plugin-legacy-"))
    temps.push(root)
    const studioRoot = path.join(root, "home")
    const project = path.join(root, "project")
    const cadRoot = path.join(root, "cad-library")
    const pcbRoot = path.join(root, "pcb-library")
    const studioConfigHome = path.join(root, "studio-config")
    await Promise.all([mkdir(studioRoot), mkdir(cadRoot), mkdir(pcbRoot), mkdir(path.join(project, ".opencode"), { recursive: true })])
    await writeFile(path.join(project, ".opencode", "studio.json"), JSON.stringify({ roots: { cad: cadRoot, pcb: pcbRoot } }))

    const plugin = createOpenCodeStudioPlugin({
      studioRoot,
      workspace: project,
      packageRoot,
      studioConfigHome,
      openCodeHome: path.join(root, "opencode-config"),
      ensureHost: false,
    })
    const hooks = await plugin({ directory: project } as any, {})
    const tools = hooks.tool as any

    await tools.design_create.execute({ id: "legacy-design", parts: [{ id: "body" }] }, { ask: async () => {} })
    expect(await Bun.file(path.join(cadRoot, "designs", "legacy-design", "design.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(studioRoot, "designs", "legacy-design", "design.json")).exists()).toBe(false)
    expect(JSON.parse(await tools.pcb_workspace_list.execute({}, {})).workspaceRoot).toBe(pcbRoot)
    expect((await readStudioConfigFile({ studioConfigHome })).roots).toEqual({ cad: cadRoot, pcb: pcbRoot })
  }, 60_000)
})
