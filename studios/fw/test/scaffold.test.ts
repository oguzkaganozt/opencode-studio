import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { scaffoldFwProject } from "../scaffold"
import { readManifest } from "../workspace"

const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("fw scaffold", () => {
  test("writes an ESP-IDF hello-world tree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-sc-"))
    temps.push(root)
    const created = await scaffoldFwProject(root, "hello", "esp32")
    const manifest = await readManifest(created.directory)
    expect(manifest).toEqual({ id: "hello", name: "hello", chip: "esp32" })
    const main = await readFile(path.join(created.directory, "main", "main.c"), "utf8")
    expect(main).toContain("app_main")
    expect(await readFile(path.join(created.directory, "CMakeLists.txt"), "utf8")).toContain("IDF_PATH")
  })

  test("refuses to overwrite an existing project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-sc-"))
    temps.push(root)
    await scaffoldFwProject(root, "hello", "esp32")
    await expect(scaffoldFwProject(root, "hello", "esp32c6")).rejects.toThrow(/already exists/)
    const manifest = await readManifest(path.join(root, "hello"))
    expect(manifest.chip).toBe("esp32")
  })
})
