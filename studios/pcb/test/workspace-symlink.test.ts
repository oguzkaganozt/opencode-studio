import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { discoverProjects } from "../workspace"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("discoverProjects symlink confinement", () => {
  test("does not follow directory symlinks to external trees", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-pcb-ws-"))
    temps.push(workspace)
    const outside = await mkdtemp(path.join(tmpdir(), "osc-pcb-out-"))
    temps.push(outside)

    // Real project inside workspace
    await mkdir(path.join(workspace, "real-proj", "src"), { recursive: true })
    await writeFile(path.join(workspace, "real-proj", "src", "circuit.tsx"), "export default () => null")

    // External project outside workspace
    await mkdir(path.join(outside, "secret-proj", "src"), { recursive: true })
    await mkdir(path.join(outside, "secret-proj", "dist", "src", "circuit"), { recursive: true })
    await writeFile(path.join(outside, "secret-proj", "src", "circuit.tsx"), "export default () => null")
    await writeFile(
      path.join(outside, "secret-proj", "dist", "src", "circuit", "circuit.json"),
      '[{"type":"source_component","name":"U1","manufacturer_part_number":"SECRET-MPN"}]',
    )

    // Symlink from workspace to outside
    await symlink(outside, path.join(workspace, "link"))

    const projects = await discoverProjects(workspace)
    const names = projects.map((p) => p.name)
    expect(names).toContain("real-proj")
    expect(names).not.toContain("secret-proj")
  })

  test("skips symlinked project directories", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "osc-pcb-ws-"))
    temps.push(workspace)
    const outside = await mkdtemp(path.join(tmpdir(), "osc-pcb-out-"))
    temps.push(outside)

    await mkdir(path.join(outside, "linked-proj", "src"), { recursive: true })
    await writeFile(path.join(outside, "linked-proj", "src", "circuit.tsx"), "export default () => null")
    await symlink(path.join(outside, "linked-proj"), path.join(workspace, "linked-proj"))

    const projects = await discoverProjects(workspace)
    expect(projects.map((p) => p.name)).not.toContain("linked-proj")
  })
})
