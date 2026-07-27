import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { initializeLibrary, inspectManagedAsset, personalOutputPath, scanLibrary } from "../library"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "osc-lib-"))
  temps.push(root)
  return root
}

// Minimal valid PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

describe("workspace media library", () => {
  test("initializeLibrary requires absolute root", async () => {
    await expect(initializeLibrary({ root: "relative" })).rejects.toThrow(/absolute/)
  })

  test("personalOutputPath defaults under media/ and jails escapes", async () => {
    const root = await workspace()
    const layout = await initializeLibrary({ root })
    expect(personalOutputPath(layout, "image", undefined, "a.png")).toBe(path.join(root, "media", "a.png"))
    expect(personalOutputPath(layout, "image", "shot.png", "a.png")).toBe(path.join(root, "media", "shot.png"))
    expect(personalOutputPath(layout, "image", "assets/out.png", "a.png")).toBe(path.join(root, "assets", "out.png"))
    expect(() => personalOutputPath(layout, "image", "../../../etc/passwd", "a.png")).toThrow(/inside the workspace/)
  })

  test("scan and inspect workspace media", async () => {
    const root = await workspace()
    const layout = await initializeLibrary({ root })
    await mkdir(layout.mediaDir, { recursive: true })
    const file = path.join(layout.mediaDir, "dot.png")
    await writeFile(file, PNG)
    const assets = await scanLibrary({ root, limit: 50, offset: 0 })
    expect(assets.some((a) => a.filePath === file)).toBe(true)
    const info = await inspectManagedAsset(root, file)
    expect(info.modality).toBe("image")
    expect(info.mime).toBe("image/png")
  })
})
