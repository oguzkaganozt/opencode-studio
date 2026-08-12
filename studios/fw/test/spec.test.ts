import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { hashSourceFiles } from "../../../src/core/spec"
import { FW_SPEC_SOURCES, readResolvedSpec, resolveSpecProject } from "../../../src/core/spec-resolve"
import { createFwStudioPlugin } from "../tools"

const root = path.join(import.meta.dir, ".tmp-fw-spec")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("fw spec", () => {
  test("publish writes SPEC.json for stock read", async () => {
    await mkdir(root, { recursive: true })
    const hooks = await createFwStudioPlugin({ workspaceRoot: root })({ directory: root, worktree: root } as never, {})
    await hooks.tool!.fw_project_create.execute({ id: "node", chip: "esp32" }, {} as never)
    const published = JSON.parse((await hooks.tool!.fw_spec.execute({ id: "node" }, {} as never)) as string)
    expect(published.status).toBe("blocked")
    expect(published.studio).toBe("fw")
    expect(hooks.tool!.fw_spec_read).toBeUndefined()
    const roots = { cad: root, pcb: root, fw: root }
    const read = await readResolvedSpec(roots, "fw", "node")
    expect(read.id).toBe("node")
    expect(read.facts.buildOk).toBeNull()
  })

  test("does not publish sim-ok when sources no longer match the run", async () => {
    await mkdir(root, { recursive: true })
    const hooks = await createFwStudioPlugin({ workspaceRoot: root })({ directory: root, worktree: root } as never, {})
    await hooks.tool!.fw_project_create.execute({ id: "node", chip: "esp32" }, {} as never)
    const roots = { cad: root, pcb: root, fw: root }
    const project = await resolveSpecProject(roots, "fw", "node")
    await mkdir(path.join(project.directory, "sim"), { recursive: true })
    await writeFile(
      path.join(project.directory, "sim", "last.json"),
      `${JSON.stringify({
        ok: true,
        reason: "expect",
        engine: "qemu",
        chip: "esp32",
        sourceHash: "not-current",
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        durationMs: 1,
        logPath: "sim/uart.log",
      })}\n`,
    )
    const stale = JSON.parse((await hooks.tool!.fw_spec.execute({ id: "node" }, {} as never)) as string)
    expect(stale.status).toBe("blocked")
    expect(stale.facts.simOk).toBe(false)
    const currentHash = await hashSourceFiles(project.sourceFiles)
    expect(project.sourceFiles.some((file) => file.endsWith("sdkconfig.defaults"))).toBe(true)
    await writeFile(
      path.join(project.directory, "sim", "last.json"),
      `${JSON.stringify({
        ok: true,
        reason: "expect",
        engine: "qemu",
        chip: "esp32",
        sourceHash: currentHash,
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        durationMs: 1,
        logPath: "sim/uart.log",
      })}\n`,
    )
    const fresh = JSON.parse((await hooks.tool!.fw_spec.execute({ id: "node" }, {} as never)) as string)
    expect(fresh.status).toBe("published")
    expect(fresh.facts.simOk).toBe(true)
    expect(FW_SPEC_SOURCES).toContain("sdkconfig.defaults")
  })
})

