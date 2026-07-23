import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readStudioConfigFile } from "../src/config"
import { configureStudios, doctorStudios, removeStudios, statusStudios } from "../src/lifecycle"

const packageRoot = path.resolve(import.meta.dir, "..")
const temps: string[] = []

async function tempWorkspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "osc-ws-"))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("configureStudios", () => {
  test("fails closed with no config", async () => {
    const workspace = await tempWorkspace()
    const status = await statusStudios({ workspace, packageRoot })
    expect(status.enabled).toEqual([])
    expect(status.studios.every((s) => !s.enabled)).toBe(true)
  })

  test("enables selected studios and installs skills", async () => {
    const workspace = await tempWorkspace()
    const result = await configureStudios({
      workspace,
      enabled: ["startup"],
      packageRoot,
      validateOpenCode: false,
    })
    expect(result.enabled).toEqual(["startup"])
    const config = await readStudioConfigFile(workspace)
    expect(config.enabled).toEqual(["startup"])
    const skill = path.join(workspace, ".opencode/skills/startup-studio/SKILL.md")
    expect(await Bun.file(skill).exists()).toBe(true)
    const marker = JSON.parse(await readFile(path.join(workspace, ".opencode/skills/startup-studio/.opencode-studio-managed.json"), "utf8"))
    expect(marker.studioId).toBe("startup")
    const openCode = JSON.parse(await readFile(path.join(workspace, "opencode.json"), "utf8"))
    const pkgName = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).name as string
    expect(openCode.plugin.some((entry: string) => String(entry).startsWith(`${pkgName}@`))).toBe(true)
  })

  test("refuses unknown studio ids", async () => {
    const workspace = await tempWorkspace()
    await expect(
      configureStudios({
        workspace,
        enabled: ["nope"],
        packageRoot,
        validateOpenCode: false,
      }),
    ).rejects.toThrow(/Unknown Studio ID/)
  })

  test("refuses user-modified skills", async () => {
    const workspace = await tempWorkspace()
    await configureStudios({
      workspace,
      enabled: ["startup"],
      packageRoot,
      validateOpenCode: false,
    })
    const skill = path.join(workspace, ".opencode/skills/startup-studio/SKILL.md")
    await writeFile(skill, `${await readFile(skill, "utf8")}\n# user edit\n`)
    await expect(
      configureStudios({
        workspace,
        enabled: [],
        packageRoot,
        validateOpenCode: false,
      }),
    ).rejects.toThrow(/modified by the user/)
  })

  test("remove clears managed state", async () => {
    const workspace = await tempWorkspace()
    await configureStudios({
      workspace,
      enabled: ["startup"],
      packageRoot,
      validateOpenCode: false,
    })
    await removeStudios({ workspace, packageRoot, validateOpenCode: false })
    const config = await readStudioConfigFile(workspace)
    expect(config.enabled).toEqual([])
    expect(await Bun.file(path.join(workspace, ".opencode/skills/startup-studio/SKILL.md")).exists()).toBe(false)
  })

  test("doctor reports enabled studio", async () => {
    const workspace = await tempWorkspace()
    await configureStudios({
      workspace,
      enabled: ["startup"],
      packageRoot,
      validateOpenCode: false,
    })
    const result = await doctorStudios({ workspace, packageRoot })
    expect(result.checks.some((c) => c.id === "skill:startup" && c.status === "pass")).toBe(true)
  })
})
