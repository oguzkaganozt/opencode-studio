import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const id = "existing-scaffold-regression"
const target = path.join(root, "studios", id)

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

describe("create-studio", () => {
  test("refuses an existing target before writing files", async () => {
    await mkdir(target)
    const marker = path.join(target, "keep.txt")
    await writeFile(marker, "untouched")

    const proc = Bun.spawn(["bun", "scripts/create-studio.ts", id], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])

    expect(code).toBe(1)
    expect(stderr).toContain("Refusing to overwrite existing directory")
    expect(await Bun.file(marker).text()).toBe("untouched")
    expect(await Bun.file(path.join(target, "studio.ts")).exists()).toBe(false)
  })

  test("scaffolds a dedicated skill and agent", async () => {
    const proc = Bun.spawn(["bun", "scripts/create-studio.ts", id], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    })
    const code = await proc.exited

    expect(code).toBe(0)
    expect(await Bun.file(path.join(target, "skill", "SKILL.md")).text()).toContain(`name: studio-${id}`)
    const agent = await Bun.file(path.join(target, "agent", `studio-${id}.md`)).text()
    expect(agent).toContain("mode: primary")
    expect(agent).toContain("hidden: true")
    expect(agent).toContain(`studio-${id}: allow`)
  })
})
