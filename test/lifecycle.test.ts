import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readStudioConfigFile } from "../src/config"
import { configureStudios, doctorStudios, removeStudios, statusStudios } from "../src/lifecycle"

const packageRoot = path.resolve(import.meta.dir, "..")
const temps: string[] = []

async function isolated() {
  const root = await mkdtemp(path.join(tmpdir(), "osc-ws-"))
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

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("configureStudios", () => {
  test("fails closed with no config for domain studios", async () => {
    const ctx = await isolated()
    const status = await statusStudios(ctx)
    expect(status.enabled).toEqual([])
    expect(status.studios.every((s) => !s.enabled)).toBe(true)
  })

  test("enables selected studios and installs skills globally", async () => {
    const ctx = await isolated()
    const result = await configureStudios({
      ...ctx,
      enabled: ["pcb"],
      validateOpenCode: false,
    })
    expect(result.enabled).toEqual(["pcb"])
    const config = await readStudioConfigFile(ctx)
    expect(config.enabled).toEqual(["pcb"])
    expect(config.configPath.startsWith(ctx.studioConfigHome)).toBe(true)
    const skill = path.join(ctx.openCodeHome, "skills/pcb-studio/SKILL.md")
    expect(await Bun.file(skill).exists()).toBe(true)
    const marker = JSON.parse(await readFile(path.join(ctx.openCodeHome, "skills/pcb-studio/.opencode-studio-managed.json"), "utf8"))
    expect(marker.studioId).toBe("pcb")
    // Platform media skill always installed
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/media/SKILL.md")).exists()).toBe(true)
    const openCode = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    const pkgName = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).name as string
    expect(openCode.plugin.some((entry: string) => String(entry).startsWith(`${pkgName}@`))).toBe(true)
    expect(openCode.plugin.some((entry: string) => String(entry).includes("/media-go"))).toBe(true)
    // Domain root must stay clean of config clutter
    expect(await Bun.file(path.join(ctx.workspace, "opencode.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, ".opencode/studio.json")).exists()).toBe(false)
  })

  test("refuses unknown studio ids", async () => {
    const ctx = await isolated()
    await expect(
      configureStudios({
        ...ctx,
        enabled: ["nope"],
        validateOpenCode: false,
      }),
    ).rejects.toThrow(/Unknown Studio ID/)
  })

  test("refuses user-modified skills", async () => {
    const ctx = await isolated()
    await configureStudios({
      ...ctx,
      enabled: ["pcb"],
      validateOpenCode: false,
    })
    const skill = path.join(ctx.openCodeHome, "skills/pcb-studio/SKILL.md")
    await writeFile(skill, `${await readFile(skill, "utf8")}\n# user edit\n`)
    await expect(
      configureStudios({
        ...ctx,
        enabled: [],
        validateOpenCode: false,
      }),
    ).rejects.toThrow(/modified by the user/)
  })

  test("remove clears domain studios but keeps platform", async () => {
    const ctx = await isolated()
    await configureStudios({
      ...ctx,
      enabled: ["pcb"],
      validateOpenCode: false,
    })
    await removeStudios({ ...ctx, validateOpenCode: false })
    const config = await readStudioConfigFile(ctx)
    expect(config.enabled).toEqual([])
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/pcb-studio/SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/media/SKILL.md")).exists()).toBe(true)
    const openCode = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    expect(openCode.plugin.some((entry: string) => String(entry).includes("/media-go"))).toBe(true)
  })

  test("doctor reports enabled studio and platform media", async () => {
    const ctx = await isolated()
    await configureStudios({
      ...ctx,
      enabled: ["pcb"],
      validateOpenCode: false,
    })
    const result = await doctorStudios(ctx)
    expect(result.checks.some((c) => c.id === "skill:pcb" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "skill:media" && c.status === "pass")).toBe(true)
  })

  test("configure scrubs legacy project-local managed files", async () => {
    const ctx = await isolated()
    const skillDir = path.join(ctx.workspace, ".opencode/skills/pcb-studio")
    await mkdir(skillDir, { recursive: true })
    const skillBody = await readFile(path.join(packageRoot, "studios/pcb/skill/SKILL.md"))
    const digest = createHash("sha256").update(skillBody).digest("hex")
    await writeFile(path.join(skillDir, "SKILL.md"), skillBody)
    await writeFile(
      path.join(skillDir, ".opencode-studio-managed.json"),
      JSON.stringify({ studioId: "pcb", packageVersion: "0.0.0", digest }),
    )
    await writeFile(
      path.join(ctx.workspace, "opencode.json"),
      JSON.stringify({ plugin: ["@oguzkaganozt/opencode-studio@0.1.0"], mcp: {} }, null, 2),
    )
    await writeFile(path.join(ctx.workspace, ".opencode/studio.json"), JSON.stringify({ enabled: ["pcb"] }))

    await configureStudios({
      ...ctx,
      enabled: ["pcb"],
      validateOpenCode: false,
    })

    expect(await Bun.file(path.join(skillDir, "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, ".opencode/studio.json")).exists()).toBe(false)
    // Schema-only project pin is removed entirely after scrub.
    expect(await Bun.file(path.join(ctx.workspace, "opencode.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, ".opencode")).exists()).toBe(false)
  })
})
