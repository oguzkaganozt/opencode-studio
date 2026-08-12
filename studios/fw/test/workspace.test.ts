import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { scaffoldFwProject } from "../scaffold"
import { listFwProjects, resolveFwProject } from "../workspace"

const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("fw workspace", () => {
  test("lists only projects with a valid manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-ws-"))
    temps.push(root)
    await scaffoldFwProject(root, "blink", "esp32c6")
    await mkdir(path.join(root, "orphan"), { recursive: true })
    await writeFile(path.join(root, "orphan", "readme.txt"), "nope")
    const projects = await listFwProjects(root)
    expect(projects.map((item) => item.id)).toEqual(["blink"])
    expect(projects[0]?.engine).toBe("esp-emu")
  })

  test("rejects unsafe ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-ws-"))
    temps.push(root)
    await expect(resolveFwProject(root, "../etc")).rejects.toThrow(/Invalid Firmware project id/)
  })
})
