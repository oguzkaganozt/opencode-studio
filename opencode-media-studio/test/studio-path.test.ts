import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { prepareNewOutput, validateStudioDirectory, verifyNewOutput, writeNewFileAtomic } from "../src/studio-path"

const root = path.join(import.meta.dir, ".studio-path-tmp")

afterEach(() => rm(root, { recursive: true, force: true }))

describe("Studio paths", () => {
  test("confines new outputs to the Studio root", async () => {
    await mkdir(root, { recursive: true })
    await expect(prepareNewOutput({ root, outputPath: "../escape.png", async ask() {} })).rejects.toThrow("inside the Studio root")
  })

  test("validates relative media directories without following symlinks", async () => {
    const outside = `${root}-outside`
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await mkdir(path.join(root, "custom"))
    await symlink(outside, path.join(root, "linked"))
    try {
      expect(await validateStudioDirectory(root, "custom/media")).toBe(path.join("custom", "media"))
      await expect(validateStudioDirectory(root, "../outside")).rejects.toThrow("inside the Studio root")
      await expect(validateStudioDirectory(root, path.join(root, "media"))).rejects.toThrow("relative")
      await expect(validateStudioDirectory(root, "linked/media")).rejects.toThrow("Unsafe media directory")
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test("asks before creating output directories and writes without overwrite", async () => {
    await mkdir(root, { recursive: true })
    const permissions: string[] = []
    const target = await prepareNewOutput({
      root,
      outputPath: "media/generated/image.png",
      async ask(input) {
        permissions.push(input.permission)
      },
    })
    await writeNewFileAtomic(target.outputPath, Buffer.from("first"))

    expect(permissions).toEqual(["edit"])
    expect(await readFile(target.outputPath, "utf8")).toBe("first")
    await expect(writeNewFileAtomic(target.outputPath, Buffer.from("second"))).rejects.toThrow("already exists")
    expect(await readFile(target.outputPath, "utf8")).toBe("first")
  })

  test("rejects symlink output directories", async () => {
    const outside = `${root}-outside`
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await symlink(outside, path.join(root, "linked"))
    try {
      await expect(prepareNewOutput({ root, outputPath: "linked/image.png", async ask() {} })).rejects.toThrow("Unsafe output directory")
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test("rejects an existing target", async () => {
    await mkdir(path.join(root, "media"), { recursive: true })
    await writeFile(path.join(root, "media/image.png"), "existing")
    await expect(prepareNewOutput({ root, outputPath: "media/image.png", async ask() {} })).rejects.toThrow("already exists")
    await expect(verifyNewOutput(root, path.join(root, "media/image.png"))).rejects.toThrow("already exists")
  })
})
