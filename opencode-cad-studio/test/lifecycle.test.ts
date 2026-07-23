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
  const root = await mkdtemp(path.join(tmpdir(), "cad-lifecycle-"))
  roots.push(root)
  return root
}

describe("CAD Studio package manifest", () => {
  test("loads opencode-studio.json for the CAD package", async () => {
    const meta = await loadPackageMeta(packageRoot)
    expect(meta.studioId).toBe("cad")
    expect(meta.pluginSpecifier).toBe("opencode-cad-studio")
    expect(meta.skillName).toBe("cad-studio")
    expect(meta.contractVersion).toBe("1.0.0")
  })

  test("rejects unknown manifest fields", () => {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        id: "cad",
        contractVersion: "1.0.0",
        minimumOpenCode: "1.18.2",
        plugin: ".",
        skill: "./skills/cad-studio",
        extra: true,
      }),
    ).toThrow(/unknown field/)
  })
})

describe("CAD Studio lifecycle paths", () => {
  test("resolves the default and XDG config homes", () => {
    const defaults = resolveLifecyclePaths({
      packageRoot,
      skillName: "cad-studio",
      sourceSkillFile: "/pkg/skills/cad-studio/SKILL.md",
      env: {},
      homedir: () => "/home/test",
    })
    expect(defaults.skillFile).toBe("/home/test/.config/opencode/skills/cad-studio/SKILL.md")
    expect(defaults.markerFile).toBe("/home/test/.config/opencode/skills/cad-studio/.osc-managed.json")
    expect(defaults.configFile).toBe("/home/test/.config/opencode/opencode.json")

    const xdg = resolveLifecyclePaths({
      packageRoot,
      skillName: "cad-studio",
      sourceSkillFile: "/pkg/skills/cad-studio/SKILL.md",
      env: { XDG_CONFIG_HOME: "/custom/config" },
    })
    expect(xdg.skillFile).toBe("/custom/config/opencode/skills/cad-studio/SKILL.md")
  })

  test("explicit config home takes precedence and must be absolute", () => {
    const paths = resolveLifecyclePaths({
      packageRoot,
      configHome: "/explicit",
      skillName: "cad-studio",
      sourceSkillFile: "/pkg/skills/cad-studio/SKILL.md",
      env: { XDG_CONFIG_HOME: "/ignored" },
    })
    expect(paths.configHome).toBe("/explicit")
    expect(() =>
      resolveLifecyclePaths({
        packageRoot,
        configHome: "relative",
        skillName: "cad-studio",
        sourceSkillFile: "/pkg/SKILL.md",
      }),
    ).toThrow(/absolute path/)
  })

  test("rejects implicit root installation without --config-home", () => {
    expect(() =>
      resolveLifecyclePaths({
        packageRoot,
        skillName: "cad-studio",
        sourceSkillFile: "/pkg/skills/cad-studio/SKILL.md",
        env: {},
        getuid: () => 0,
        homedir: () => "/root",
      }),
    ).toThrow(/implicit root/)
    expect(
      resolveLifecyclePaths({
        packageRoot,
        configHome: "/home/user/.config",
        skillName: "cad-studio",
        sourceSkillFile: "/pkg/skills/cad-studio/SKILL.md",
        getuid: () => 0,
      }).configHome,
    ).toBe("/home/user/.config")
  })

  test("project scope installs under .opencode/skills", () => {
    const paths = resolveLifecyclePaths({
      packageRoot,
      scope: "project",
      projectRoot: "/proj",
      skillName: "cad-studio",
      sourceSkillFile: "/pkg/skills/cad-studio/SKILL.md",
    })
    expect(paths.skillDirectory).toBe("/proj/.opencode/skills/cad-studio")
    expect(paths.configFile).toBe("/proj/opencode.json")
  })
})

describe("CAD Studio skill content", () => {
  test("documents the pinned build123d-mcp comparison and render contract", async () => {
    const content = await readFile(path.resolve(import.meta.dir, "../skills/cad-studio/SKILL.md"), "utf8")
    expect(content).toContain("build123d-mcp@0.3.77")
    expect(content).toContain('build123d_compare(a="body_built", b="lid_built", kind="fit")')
    expect(content).toContain('build123d_render_view(objects="body,lid", direction="iso"')
    expect(content).toContain("Directions are `iso`, `front`, `side`, and `top`")
    expect(content).toContain("Reference Form Fidelity")
    expect(content).toContain("do not collapse them into a constant primitive with cosmetic fillets")
    expect(content).toContain("front, side, and isometric views")
    expect(content).toContain("Keep genuinely simple references simple")
    expect(content).toContain("Manufactured Freeform Mode")
    expect(content).toContain("Face.make_gordon_surface()")
    expect(content).toContain("build matched inner sections and subtract the inner loft")
    expect(content).toContain("area, in-plane width/depth, and centre")
    expect(content).toContain("Do not use dense `Polyline` sections or `ruled=True` as a stability shortcut")
    expect(content).toContain("Hundreds of narrow surface faces")
    expect(content).toContain("Build succeeded; form fidelity unverified.")
    expect(content).toContain("current build123d BREP workflow is not the right engine")
    expect(content).toContain("Python namespace and named-object registry are separate")
    expect(content).toContain("Any source geometry change invalidates every prior render")
    expect(content).toContain("execute the exact canonical source implementation in-session")
    expect(content).toContain("Global clearance zero proves only that some surfaces touch")
    expect(content).toContain("open, first engagement, maximum deflection/interference, and closed positions")
    expect(content).toContain("retention geometry staged; elastic snap behavior unverified")
    expect(content).toContain("current world orientation as its print orientation")
    expect(content).not.toContain("`interference(step_a, step_b)`")
    expect(content).not.toContain('render_view(object_name="body"')
  })
})

describe("CAD Studio install/remove ownership", () => {
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
    expect(result.plugin).toBe("opencode-cad-studio")
    expect(await readFile(result.paths.skillFile, "utf8")).toContain("name: cad-studio")
    const marker = JSON.parse(await readFile(result.paths.markerFile, "utf8")) as {
      studioId: string
      packageVersion: string
      digest: string
    }
    expect(marker.studioId).toBe("cad")
    expect(marker.digest).toBe(result.digest)
    const config = JSON.parse(await readFile(result.paths.configFile, "utf8")) as { plugin: string[] }
    expect(config.plugin).toContain("opencode-cad-studio")
  })

  test("install is idempotent for an unchanged managed skill", async () => {
    const root = await tempRoot()
    const configHome = path.join(root, "config")
    await installStudio({ packageRoot, configHome })
    const second = await installStudio({ packageRoot, configHome })
    expect(second.registered).toBe(true)
    expect(await readFile(second.paths.skillFile, "utf8")).toContain("name: cad-studio")
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
    const skillDir = path.join(configHome, "opencode", "skills", "cad-studio")
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
    const skillDir = path.join(configHome, "opencode", "skills", "cad-studio")
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
