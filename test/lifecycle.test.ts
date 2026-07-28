import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readStudioConfigFile } from "../src/config"
import { STUDIO_IDS } from "../src/core/registry"
import { configureStudios, removeStudios, statusStudios } from "../src/lifecycle"

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
  test("status reports all studios always on without prior configure", async () => {
    const ctx = await isolated()
    const status = await statusStudios(ctx)
    expect(status.enabled).toEqual([...STUDIO_IDS])
    expect(status.studios.every((s) => s.enabled)).toBe(true)
  })

  test("installs all domain skills and plugins globally", async () => {
    const ctx = await isolated()
    const result = await configureStudios({
      ...ctx,
      validateOpenCode: false,
    })
    expect(result.enabled).toEqual([...STUDIO_IDS])
    const config = await readStudioConfigFile(ctx)
    expect(config.enabled).toEqual([...STUDIO_IDS])
    expect(config.configPath.startsWith(ctx.studioConfigHome)).toBe(true)
    for (const id of STUDIO_IDS) {
      const skill = path.join(ctx.openCodeHome, `skills/studio-${id}/SKILL.md`)
      expect(await Bun.file(skill).exists()).toBe(true)
    }
    const marker = JSON.parse(await readFile(path.join(ctx.openCodeHome, "skills/studio-pcb/.opencode-studio-managed.json"), "utf8"))
    expect(marker.studioId).toBe("pcb")
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/studio-media/SKILL.md")).exists()).toBe(true)
    const openCode = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    const pkgName = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).name as string
    expect(openCode.plugin).toContain(pkgName)
    expect(openCode.plugin).toContain(`${pkgName}/media-go`)
    expect(openCode.plugin.some((entry: string) => String(entry).startsWith(`${pkgName}@`))).toBe(false)
    expect(openCode.mcp?.build123d).toBeTruthy()
    expect(await Bun.file(path.join(ctx.workspace, "opencode.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, ".opencode/studio.json")).exists()).toBe(false)
  })

  test("refuses user-modified skills", async () => {
    const ctx = await isolated()
    await configureStudios({
      ...ctx,
      validateOpenCode: false,
    })
    const skill = path.join(ctx.openCodeHome, "skills/studio-pcb/SKILL.md")
    await writeFile(skill, `${await readFile(skill, "utf8")}\n# user edit\n`)
    await expect(
      configureStudios({
        ...ctx,
        validateOpenCode: false,
      }),
    ).rejects.toThrow(/modified by the user/)
  })

  test("remove uninstalls managed skills and plugins", async () => {
    const ctx = await isolated()
    await configureStudios({
      ...ctx,
      validateOpenCode: false,
    })
    await removeStudios({ ...ctx, validateOpenCode: false })
    const config = await readStudioConfigFile(ctx)
    expect(config.enabled).toEqual([...STUDIO_IDS])
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/studio-pcb/SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/studio-cad/SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/studio-media/SKILL.md")).exists()).toBe(false)
    const openCode = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    const pkgName = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).name as string
    expect(openCode.plugin ?? []).not.toContain(pkgName)
    expect(openCode.plugin ?? []).not.toContain(`${pkgName}/media-go`)
    expect(openCode.mcp?.build123d).toBeUndefined()
  })

  test("status reports all domain skills and platform media checks", async () => {
    const ctx = await isolated()
    await configureStudios({
      ...ctx,
      validateOpenCode: false,
    })
    const result = await statusStudios(ctx)
    expect(result.ok).toBe(true)
    expect(result.packageVersion).toBeTruthy()
    expect(result.checks.some((c) => c.id === "skill:pcb" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "skill:cad" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "skill:media" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "mcp-build123d" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "plugin-registration" && c.status === "pass")).toBe(true)
  })

  test("configure scrubs legacy project-local managed files", async () => {
    const ctx = await isolated()
    const skillDir = path.join(ctx.workspace, ".opencode/skills/studio-pcb")
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
      validateOpenCode: false,
    })

    expect(await Bun.file(path.join(skillDir, "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, ".opencode/studio.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, "opencode.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, ".opencode")).exists()).toBe(false)
  })
})
