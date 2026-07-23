import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { installStudio, pluginEntryMatches, removeStudio, resolveLifecyclePaths } from "../src/lifecycle"
import { loadPackageMeta, validateManifest } from "../src/package-meta"

const roots: string[] = []
const packageRoot = path.resolve(import.meta.dir, "..")

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "media-lifecycle-"))
  roots.push(root)
  return root
}

describe("Media Studio package manifest", () => {
  test("loads opencode-studio.json for the media package", async () => {
    const meta = await loadPackageMeta(packageRoot)
    expect(meta.studioId).toBe("media")
    expect(meta.pluginSpecifier).toBe("opencode-media-studio/server")
    expect(meta.skillName).toBe("media-studio")
    expect(meta.contractVersion).toBe("1.0.0")
  })

  test("rejects unknown manifest fields", () => {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        id: "media",
        contractVersion: "1.0.0",
        minimumOpenCode: "1.18.2",
        plugin: "./server",
        skill: "./skills/media-studio",
        extra: true,
      }),
    ).toThrow(/unknown field/)
  })
})

describe("Media Studio lifecycle paths", () => {
  test("resolves the default and XDG config homes", () => {
    const defaults = resolveLifecyclePaths({
      packageRoot,
      skillName: "media-studio",
      sourceSkillFile: "/pkg/skills/media-studio/SKILL.md",
      env: {},
      homedir: () => "/home/test",
    })
    expect(defaults.skillFile).toBe("/home/test/.config/opencode/skills/media-studio/SKILL.md")
    expect(defaults.markerFile).toBe("/home/test/.config/opencode/skills/media-studio/.osc-managed.json")
    expect(defaults.configFile).toBe("/home/test/.config/opencode/opencode.json")

    const xdg = resolveLifecyclePaths({
      packageRoot,
      skillName: "media-studio",
      sourceSkillFile: "/pkg/skills/media-studio/SKILL.md",
      env: { XDG_CONFIG_HOME: "/custom/config" },
    })
    expect(xdg.skillFile).toBe("/custom/config/opencode/skills/media-studio/SKILL.md")
  })

  test("explicit config home takes precedence and must be absolute", () => {
    const paths = resolveLifecyclePaths({
      packageRoot,
      configHome: "/explicit",
      skillName: "media-studio",
      sourceSkillFile: "/pkg/skills/media-studio/SKILL.md",
      env: { XDG_CONFIG_HOME: "/ignored" },
    })
    expect(paths.configHome).toBe("/explicit")
    expect(() =>
      resolveLifecyclePaths({
        packageRoot,
        configHome: "relative",
        skillName: "media-studio",
        sourceSkillFile: "/pkg/SKILL.md",
      }),
    ).toThrow(/absolute path/)
  })

  test("rejects implicit root installation without --config-home", () => {
    expect(() =>
      resolveLifecyclePaths({
        packageRoot,
        skillName: "media-studio",
        sourceSkillFile: "/pkg/skills/media-studio/SKILL.md",
        env: {},
        getuid: () => 0,
        homedir: () => "/root",
      }),
    ).toThrow(/implicit root/)
    expect(
      resolveLifecyclePaths({
        packageRoot,
        configHome: "/home/user/.config",
        skillName: "media-studio",
        sourceSkillFile: "/pkg/skills/media-studio/SKILL.md",
        getuid: () => 0,
      }).configHome,
    ).toBe("/home/user/.config")
  })

  test("project scope installs under .opencode/skills", () => {
    const paths = resolveLifecyclePaths({
      packageRoot,
      scope: "project",
      projectRoot: "/proj",
      skillName: "media-studio",
      sourceSkillFile: "/pkg/skills/media-studio/SKILL.md",
    })
    expect(paths.skillDirectory).toBe("/proj/.opencode/skills/media-studio")
    expect(paths.configFile).toBe("/proj/opencode.json")
  })
})

describe("Media Studio skill content", () => {
  test("documents media workflow and agent-owned Library mutations", async () => {
    const content = await readFile(path.resolve(import.meta.dir, "../skills/media-studio/SKILL.md"), "utf8")
    expect(content).toContain("name: media-studio")
    expect(content).toContain("media_list")
    expect(content).toContain("media_import")
    expect(content).toContain("read-only")
    expect(content).toContain("fal_submit")
    expect(content).toContain("chatgpt_image_generate")
    expect(content).toContain("serve --root")
    expect(content).toContain("Never claim Library readiness")
    expect(content).not.toContain("pcb_workspace_list")
  })
})

describe("Media Studio install/remove ownership", () => {
  test("dry-run does not create files", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const result = await installStudio({ packageRoot, configHome, dryRun: true })
    expect(result.dryRun).toBe(true)
    expect(await stat(result.paths.skillFile).catch(() => undefined)).toBeUndefined()
  })

  test("install writes managed skill, marker, and plugin registration", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const result = await installStudio({ packageRoot, configHome })
    expect(result.plugin).toBe("opencode-media-studio/server")
    expect(await readFile(result.paths.skillFile, "utf8")).toContain("name: media-studio")
    const marker = JSON.parse(await readFile(result.paths.markerFile, "utf8")) as {
      studioId: string
      packageVersion: string
      digest: string
    }
    expect(marker.studioId).toBe("media")
    expect(marker.digest).toBe(result.digest)
    const config = JSON.parse(await readFile(result.paths.configFile, "utf8")) as { plugin: string[] }
    expect(config.plugin).toContain("opencode-media-studio/server")
  })

  test("install is idempotent for an unchanged managed skill", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    await installStudio({ packageRoot, configHome })
    const second = await installStudio({ packageRoot, configHome })
    expect(second.registered).toBe(true)
    expect(await readFile(second.paths.skillFile, "utf8")).toContain("name: media-studio")
  })

  test("install does not duplicate a legacy absolute plugin path", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const configDir = path.join(configHome, "opencode")
    await mkdir(configDir, { recursive: true })
    const legacyPath = "/opt/opencode-media-studio/current/node_modules/opencode-media-studio/dist/plugin.js"
    await writeFile(
      path.join(configDir, "opencode.json"),
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          plugin: [[legacyPath, { libraryRoot: "/srv/opencode-media-studio" }]],
        },
        null,
        2,
      )}\n`,
    )
    expect(pluginEntryMatches([legacyPath, {}], "opencode-media-studio/server", "opencode-media-studio")).toBe(true)
    const result = await installStudio({ packageRoot, configHome })
    expect(result.registered).toBe(true)
    const config = JSON.parse(await readFile(result.paths.configFile, "utf8")) as { plugin: unknown[] }
    expect(config.plugin).toHaveLength(1)
    expect(config.plugin[0]).toEqual([legacyPath, { libraryRoot: "/srv/opencode-media-studio" }])
    expect(config.plugin).not.toContain("opencode-media-studio/server")
  })

  test("install refuses a user-modified managed skill", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const first = await installStudio({ packageRoot, configHome })
    await writeFile(first.paths.skillFile, "stale")
    await expect(installStudio({ packageRoot, configHome })).rejects.toThrow(/modified by the user/)
  })

  test("install refuses an unmarked existing skill", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const skillDir = path.join(configHome, "opencode", "skills", "media-studio")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "user skill\n")
    await expect(installStudio({ packageRoot, configHome })).rejects.toThrow(/unmarked skill/)
  })

  test("remove deletes managed skill and marker but preserves sibling files", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const installed = await installStudio({ packageRoot, configHome })
    const userFile = path.join(installed.paths.skillDirectory, "notes.md")
    await writeFile(userFile, "keep")

    await removeStudio({ packageRoot, configHome })
    expect(await stat(installed.paths.skillFile).catch(() => undefined)).toBeUndefined()
    expect(await stat(installed.paths.markerFile).catch(() => undefined)).toBeUndefined()
    expect(await readFile(userFile, "utf8")).toBe("keep")
  })

  test("remove refuses unmarked skill", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const skillDir = path.join(configHome, "opencode", "skills", "media-studio")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "user skill\n")
    await expect(removeStudio({ packageRoot, configHome })).rejects.toThrow(/unmarked skill/)
  })

  test("remove cleans orphaned ownership marker when skill file is missing", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    const installed = await installStudio({ packageRoot, configHome })
    await rm(installed.paths.skillFile, { force: true })
    expect(await Bun.file(installed.paths.markerFile).exists()).toBe(true)

    await removeStudio({ packageRoot, configHome })
    expect(await Bun.file(installed.paths.markerFile).exists()).toBe(false)
    expect(await Bun.file(installed.paths.skillFile).exists()).toBe(false)
  })
})
