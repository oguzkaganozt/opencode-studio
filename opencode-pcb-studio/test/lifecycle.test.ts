import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { installStudio, removeStudio, resolveLifecyclePaths } from "../src/lifecycle"
import { loadPackageMeta, validateManifest } from "../src/package-meta"

const roots: string[] = []
const packageRoot = path.resolve(import.meta.dir, "..")

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "pcb-lifecycle-"))
  roots.push(root)
  return root
}

describe("PCB Studio package manifest", () => {
  test("loads opencode-studio.json for the PCB package", async () => {
    const meta = await loadPackageMeta(packageRoot)
    expect(meta.studioId).toBe("pcb")
    expect(meta.pluginSpecifier).toBe("opencode-pcb-studio/server")
    expect(meta.skillName).toBe("pcb-studio")
    expect(meta.contractVersion).toBe("1.0.0")
  })

  test("rejects unknown manifest fields", () => {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        id: "pcb",
        contractVersion: "1.0.0",
        minimumOpenCode: "1.18.2",
        plugin: "./server",
        skill: "./skills/pcb-studio",
        extra: true,
      }),
    ).toThrow(/unknown field/)
  })
})

describe("PCB Studio lifecycle paths", () => {
  test("resolves the default and XDG config homes", () => {
    const defaults = resolveLifecyclePaths({
      packageRoot,
      skillName: "pcb-studio",
      sourceSkillFile: "/pkg/skills/pcb-studio/SKILL.md",
      env: {},
      homedir: () => "/home/test",
    })
    expect(defaults.skillFile).toBe("/home/test/.config/opencode/skills/pcb-studio/SKILL.md")
    expect(defaults.markerFile).toBe("/home/test/.config/opencode/skills/pcb-studio/.osc-managed.json")
    expect(defaults.configFile).toBe("/home/test/.config/opencode/opencode.json")

    const xdg = resolveLifecyclePaths({
      packageRoot,
      skillName: "pcb-studio",
      sourceSkillFile: "/pkg/skills/pcb-studio/SKILL.md",
      env: { XDG_CONFIG_HOME: "/custom/config" },
    })
    expect(xdg.skillFile).toBe("/custom/config/opencode/skills/pcb-studio/SKILL.md")
  })

  test("explicit config home takes precedence and must be absolute", () => {
    const paths = resolveLifecyclePaths({
      packageRoot,
      configHome: "/explicit",
      skillName: "pcb-studio",
      sourceSkillFile: "/pkg/skills/pcb-studio/SKILL.md",
      env: { XDG_CONFIG_HOME: "/ignored" },
    })
    expect(paths.configHome).toBe("/explicit")
    expect(() =>
      resolveLifecyclePaths({
        packageRoot,
        configHome: "relative",
        skillName: "pcb-studio",
        sourceSkillFile: "/pkg/SKILL.md",
      }),
    ).toThrow(/absolute path/)
  })

  test("rejects implicit root installation without --config-home", () => {
    expect(() =>
      resolveLifecyclePaths({
        packageRoot,
        skillName: "pcb-studio",
        sourceSkillFile: "/pkg/skills/pcb-studio/SKILL.md",
        env: {},
        getuid: () => 0,
        homedir: () => "/root",
      }),
    ).toThrow(/implicit root/)
    expect(
      resolveLifecyclePaths({
        packageRoot,
        configHome: "/home/user/.config",
        skillName: "pcb-studio",
        sourceSkillFile: "/pkg/skills/pcb-studio/SKILL.md",
        getuid: () => 0,
      }).configHome,
    ).toBe("/home/user/.config")
  })

  test("project scope installs under .opencode/skills", () => {
    const paths = resolveLifecyclePaths({
      packageRoot,
      scope: "project",
      projectRoot: "/proj",
      skillName: "pcb-studio",
      sourceSkillFile: "/pkg/skills/pcb-studio/SKILL.md",
    })
    expect(paths.skillDirectory).toBe("/proj/.opencode/skills/pcb-studio")
    expect(paths.configFile).toBe("/proj/opencode.json")
  })
})

describe("PCB Studio skill content", () => {
  test("documents incremental tscircuit authoring and manufacturing blockers", async () => {
    const content = await readFile(path.resolve(import.meta.dir, "../skills/pcb-studio/SKILL.md"), "utf8")
    expect(content).toContain("name: pcb-studio")
    expect(content).toContain("pcb_workspace_list")
    expect(content).toContain("pcb_circuit_build")
    expect(content).toContain("PCB_STUDIO_PLACEHOLDER:")
    expect(content).toContain("designValid")
    expect(content).toContain("Never claim manufacturing readiness")
    expect(content).not.toContain("build123d-mcp")
  })
})

describe("PCB Studio install/remove ownership", () => {
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
    expect(result.plugin).toBe("opencode-pcb-studio/server")
    expect(await readFile(result.paths.skillFile, "utf8")).toContain("name: pcb-studio")
    const marker = JSON.parse(await readFile(result.paths.markerFile, "utf8")) as {
      studioId: string
      packageVersion: string
      digest: string
    }
    expect(marker.studioId).toBe("pcb")
    expect(marker.digest).toBe(result.digest)
    const config = JSON.parse(await readFile(result.paths.configFile, "utf8")) as { plugin: string[] }
    expect(config.plugin).toContain("opencode-pcb-studio/server")
  })

  test("install is idempotent for an unchanged managed skill", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    await installStudio({ packageRoot, configHome })
    const second = await installStudio({ packageRoot, configHome })
    expect(second.registered).toBe(true)
    expect(await readFile(second.paths.skillFile, "utf8")).toContain("name: pcb-studio")
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
    const skillDir = path.join(configHome, "opencode", "skills", "pcb-studio")
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
    const skillDir = path.join(configHome, "opencode", "skills", "pcb-studio")
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
