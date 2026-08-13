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

  test("status fails closed when plugins/skills are unwired", async () => {
    const ctx = await isolated()
    const status = await statusStudios(ctx)
    expect(status.ok).toBe(false)
    expect(status.checks.some((c) => c.id === "plugin-registration" && c.status === "fail")).toBe(true)
    expect(status.checks.some((c) => c.id === "skill:cad" && c.status === "fail")).toBe(true)
    expect(status.checks.some((c) => c.id === "skill:fw" && c.status === "fail")).toBe(true)
  })

  test("installs all Studio skills, agents, permissions, and plugins globally", async () => {
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
      const agent = path.join(ctx.openCodeHome, `agents/studio-${id}.md`)
      expect(await Bun.file(agent).exists()).toBe(true)
      expect(await Bun.file(`${agent}.opencode-studio-managed.json`).exists()).toBe(true)
    }
    const marker = JSON.parse(await readFile(path.join(ctx.openCodeHome, "skills/studio-pcb/.opencode-studio-managed.json"), "utf8"))
    expect(marker.studioId).toBe("pcb")
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/studio-fw/SKILL.md")).exists()).toBe(true)
    const openCode = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    const pkgName = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).name as string
    expect(openCode.plugin).toContain(`file://${path.join(packageRoot, "dist/plugin.js")}`)
    expect(openCode.plugin.some((p: string) => String(p).includes("media-go.js"))).toBe(false)
    expect(openCode.plugin.some((entry: string) => String(entry).startsWith(`${pkgName}@`))).toBe(false)
    expect(openCode.mcp?.build123d).toBeUndefined()
    expect(openCode.permission["pcb_*"]).toBe("deny")
    expect(openCode.permission["cad_*"]).toBe("deny")
    expect(openCode.permission["fw_*"]).toBe("deny")
    expect(openCode.permission.image_generate).toBeUndefined()
    expect(openCode.permission.skill["studio-fw"]).toBe("deny")
    expect(await Bun.file(path.join(ctx.workspace, "opencode.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, ".opencode/studio.json")).exists()).toBe(false)
  })

  test("configure removes leftover managed Media skill and agent", async () => {
    const ctx = await isolated()
    const skillDir = path.join(ctx.openCodeHome, "skills/studio-media")
    const skillFile = path.join(skillDir, "SKILL.md")
    const agentFile = path.join(ctx.openCodeHome, "agents/studio-media.md")
    await mkdir(skillDir, { recursive: true })
    await mkdir(path.join(ctx.openCodeHome, "agents"), { recursive: true })
    const body = "# leftover media\n"
    const digest = createHash("sha256").update(body).digest("hex")
    await writeFile(skillFile, body)
    await writeFile(
      path.join(skillDir, ".opencode-studio-managed.json"),
      JSON.stringify({ studioId: "media", packageVersion: "1.0.0", digest }),
    )
    await writeFile(agentFile, body)
    await writeFile(`${agentFile}.opencode-studio-managed.json`, JSON.stringify({ studioId: "media", packageVersion: "1.0.0", digest }))
    await configureStudios({ ...ctx, validateOpenCode: false })
    expect(await Bun.file(skillFile).exists()).toBe(false)
    expect(await Bun.file(agentFile).exists()).toBe(false)
  })

  test("configure keeps user-modified leftover Media files", async () => {
    const ctx = await isolated()
    const skillDir = path.join(ctx.openCodeHome, "skills/studio-media")
    const skillFile = path.join(skillDir, "SKILL.md")
    await mkdir(skillDir, { recursive: true })
    await writeFile(skillFile, "# edited leftover\n")
    await writeFile(
      path.join(skillDir, ".opencode-studio-managed.json"),
      JSON.stringify({ studioId: "media", packageVersion: "1.0.0", digest: "not-the-current-hash" }),
    )
    await configureStudios({ ...ctx, validateOpenCode: false })
    expect(await Bun.file(skillFile).exists()).toBe(true)
  })

  test("preserves unrelated plugin paths containing opencode-studio", async () => {
    const ctx = await isolated()
    await mkdir(ctx.openCodeHome, { recursive: true })
    const unrelated = "file:///opt/plugins/my-opencode-studio-helper.js"
    await writeFile(
      path.join(ctx.openCodeHome, "opencode.json"),
      JSON.stringify({ plugin: [unrelated], permission: { bash: "ask", skill: { personal: "allow" } } }, null, 2),
    )

    await configureStudios({ ...ctx, validateOpenCode: false })

    const openCode = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    expect(openCode.plugin).toContain(unrelated)
    expect(openCode.permission.bash).toBe("ask")
    expect(openCode.permission.skill.personal).toBe("allow")
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

  test("refuses user-modified managed agents", async () => {
    const ctx = await isolated()
    await configureStudios({ ...ctx, validateOpenCode: false })
    const agent = path.join(ctx.openCodeHome, "agents/studio-fw.md")
    await writeFile(agent, `${await readFile(agent, "utf8")}\nUser edit\n`)
    await expect(configureStudios({ ...ctx, validateOpenCode: false })).rejects.toThrow(/agent was modified by the user/)
  })

  test("configure migrates legacy roots before scrubbing the project config", async () => {
    const ctx = await isolated()
    const cadRoot = path.join(ctx.workspace, "cad-library")
    const pcbRoot = path.join(ctx.workspace, "pcb-library")
    await mkdir(cadRoot)
    await mkdir(pcbRoot)
    await mkdir(path.join(ctx.workspace, ".opencode"), { recursive: true })
    await writeFile(path.join(ctx.workspace, ".opencode", "studio.json"), JSON.stringify({ roots: { cad: cadRoot, pcb: pcbRoot } }))

    await configureStudios({
      ...ctx,
      validateOpenCode: false,
    })

    const config = await readStudioConfigFile(ctx)
    expect(config.roots).toEqual({ cad: cadRoot, pcb: pcbRoot })
    expect(await Bun.file(path.join(ctx.workspace, ".opencode", "studio.json")).exists()).toBe(false)
  })

  test("dry-run preserves legacy project roots", async () => {
    const ctx = await isolated()
    const cadRoot = path.join(ctx.workspace, "cad-library")
    await mkdir(cadRoot)
    await mkdir(path.join(ctx.workspace, ".opencode"), { recursive: true })
    const legacyPath = path.join(ctx.workspace, ".opencode", "studio.json")
    await writeFile(legacyPath, JSON.stringify({ roots: { cad: cadRoot } }))

    await configureStudios({
      ...ctx,
      dryRun: true,
      validateOpenCode: false,
    })

    expect(await Bun.file(legacyPath).exists()).toBe(true)
    expect(await Bun.file(path.join(ctx.studioConfigHome, "studio.json")).exists()).toBe(false)
    expect(await Bun.file(ctx.openCodeHome).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.workspace, "studio")).exists()).toBe(false)
  })

  test("failed repeat configure preserves unchanged managed skills", async () => {
    const ctx = await isolated()
    await configureStudios({ ...ctx, validateOpenCode: false })
    const skillFiles = ["studio-fw", "studio-cad", "studio-pcb"].map((name) => path.join(ctx.openCodeHome, "skills", name, "SKILL.md"))
    const before = await Promise.all(skillFiles.map((file) => readFile(file, "utf8")))

    await rm(ctx.studioConfigHome, { recursive: true, force: true })
    await writeFile(ctx.studioConfigHome, "blocks studio.json creation")

    await expect(configureStudios({ ...ctx, validateOpenCode: false })).rejects.toThrow()
    await expect(Promise.all(skillFiles.map((file) => readFile(file, "utf8")))).resolves.toEqual(before)
  })

  test("late configure failure restores the previous OpenCode config", async () => {
    const ctx = await isolated()
    await configureStudios({ ...ctx, validateOpenCode: false })
    const openCodePath = path.join(ctx.openCodeHome, "opencode.json")
    const current = JSON.parse(await readFile(openCodePath, "utf8"))
    delete current.permission["fw_*"]
    await writeFile(openCodePath, `${JSON.stringify(current, null, 2)}\n`)
    const before = await readFile(openCodePath, "utf8")

    await rm(ctx.studioConfigHome, { recursive: true, force: true })
    await writeFile(ctx.studioConfigHome, "blocks studio.json creation")

    await expect(configureStudios({ ...ctx, validateOpenCode: false })).rejects.toThrow()
    expect(await readFile(openCodePath, "utf8")).toBe(before)
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
    expect(await Bun.file(path.join(ctx.openCodeHome, "skills/studio-fw/SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(ctx.openCodeHome, "agents/studio-fw.md")).exists()).toBe(false)
    const openCode = JSON.parse(await readFile(path.join(ctx.openCodeHome, "opencode.json"), "utf8"))
    expect((openCode.plugin ?? []).some((entry: string) => String(entry).includes("opencode-studio"))).toBe(false)
    expect(openCode.mcp?.build123d).toBeUndefined()
    expect(openCode.permission).toBeUndefined()
  })

  test("status reports every managed Studio capability", async () => {
    const ctx = await isolated()
    await configureStudios({
      ...ctx,
      validateOpenCode: false,
    })
    const result = await statusStudios(ctx)
    expect(result.packageVersion).toBeTruthy()
    const managedIds = [
      "plugin-registration",
      "permission:studio",
      "skill:cad",
      "skill:pcb",
      "skill:fw",
      "agent:cad",
      "agent:pcb",
      "agent:fw",
      "cad-engine",
    ]
    expect(
      result.checks
        .map((check) => check.id)
        .filter((id) => managedIds.includes(id))
        .sort(),
    ).toEqual([...managedIds].sort())
    expect(result.checks.some((c) => c.id === "skill:pcb" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "skill:cad" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "skill:fw" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "cad-engine")).toBe(true)
    expect(result.checks.some((c) => c.id === "plugin-registration" && c.status === "pass")).toBe(true)
    expect(result.checks.some((c) => c.id === "engine:pcb:npm")).toBe(true)
    expect(result.ok).toBe(true)
  })

  test("status fails root checks when resolution fails but a display path is available", async () => {
    const ctx = await isolated()
    const status = await statusStudios(ctx)
    const cad = status.studios.find((studio) => studio.id === "cad")
    expect(cad?.root).toBe(path.join(ctx.workspace, "studio", "designs"))
    expect(cad?.rootError).toContain("does not exist")
    expect(status.checks.find((check) => check.id === "root:cad")?.status).toBe("fail")
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
