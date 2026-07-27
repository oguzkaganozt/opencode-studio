import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { importMediaAsset, readMediaForUpload } from "../assets"

const root = path.join(import.meta.dir, ".assets-root")
const outside = path.join(import.meta.dir, ".assets-outside")
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe("media imports", () => {
  test("keeps in-workspace media without copying", async () => {
    await mkdir(path.join(root, "media"), { recursive: true })
    const filePath = path.join(root, "media", "image.png")
    await writeFile(filePath, png)
    const permissions: string[] = []
    const result = await importMediaAsset({
      root: await realpath(root),
      filePath,
      outputRoot: await realpath(root),
      mediaDir: path.join(await realpath(root), "media"),
      signal: new AbortController().signal,
      async ask(input) {
        permissions.push(input.permission)
      },
    })
    expect(result.filePath).toBe(await realpath(filePath))
    expect(permissions).toContain("read")
  })

  test("copies external media into media/", async () => {
    await mkdir(outside, { recursive: true })
    await mkdir(root, { recursive: true })
    const source = path.join(outside, "shot.png")
    await writeFile(source, png)
    const result = await importMediaAsset({
      root: await realpath(outside),
      filePath: source,
      outputRoot: await realpath(root),
      mediaDir: path.join(await realpath(root), "media"),
      signal: new AbortController().signal,
      async ask() {},
    })
    expect(result.filePath.startsWith(path.join(await realpath(root), "media"))).toBe(true)
    expect(result.modality).toBe("image")
  })

  test("readMediaForUpload detects mime", async () => {
    await mkdir(root, { recursive: true })
    const filePath = path.join(root, "a.png")
    await writeFile(filePath, png)
    const result = await readMediaForUpload({
      root: await realpath(root),
      filePath,
      maxBytes: 1024,
      signal: new AbortController().signal,
      async ask() {},
    })
    expect(result.mime).toBe("image/png")
  })
})
