import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { createFwStudioPlugin } from "../tools"

const root = path.join(import.meta.dir, ".tmp-fw")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function hooks() {
  await mkdir(root, { recursive: true })
  return createFwStudioPlugin({ workspaceRoot: root })(
    {
      directory: root,
      worktree: root,
    } as never,
    {},
  )
}

describe("fw plugin", () => {
  test("registers Firmware Studio tools", async () => {
    const value = await hooks()
    expect(Object.keys(value.tool ?? {}).sort()).toEqual(
      ["fw_build", "fw_caps", "fw_project_create", "fw_project_read", "fw_sim_log", "fw_sim_run", "fw_workspace_list"].sort(),
    )
  })

  test("fw_caps lists chips and rejects unknown ones", async () => {
    const value = await hooks()
    const listed = JSON.parse((await value.tool!.fw_caps.execute({}, {} as never)) as string)
    expect(listed.chips.map((item: { chip: string }) => item.chip)).toEqual([
      "esp32",
      "esp32s3",
      "esp32c3",
      "esp32c6",
      "esp32h2",
      "esp32p4",
    ])
    expect(listed.chips[0]).not.toHaveProperty("qemuEfuseHex")
    await expect(value.tool!.fw_caps.execute({ chip: "esp32s2" }, {} as never)).rejects.toThrow(/Unsupported chip/)
  })

  test("create then list a project", async () => {
    const value = await hooks()
    const created = JSON.parse((await value.tool!.fw_project_create.execute({ id: "node", chip: "esp32" }, {} as never)) as string)
    expect(created.engine).toBe("qemu")
    const listed = JSON.parse((await value.tool!.fw_workspace_list.execute({}, {} as never)) as string)
    expect(listed.projects).toEqual([expect.objectContaining({ projectId: "node", chip: "esp32", engine: "qemu", capabilities: ["uart"] })])
  })
})
