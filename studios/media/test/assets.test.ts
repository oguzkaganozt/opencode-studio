import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { importMediaAsset, readMediaForUpload } from "../assets"

const root = path.join(import.meta.dir, ".assets-root")
const outside = path.join(import.meta.dir, ".assets-outside")
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")

function outputDirectories() {
  return {
    image: path.join(root, "users/tester/images"),
    audio: path.join(root, "users/tester/audio"),
    video: path.join(root, "users/tester/video"),
  }
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe("media imports", () => {
  test("registers in-root media without copying it", async () => {
    await mkdir(root, { recursive: true })
    const filePath = path.join(outputDirectories().image, "image.png")
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, png)
    const permissions: string[] = []
    const result = await importMediaAsset({
      root: await realpath(root),
      filePath,
      outputRoot: await realpath(root),
      outputDirectory: outputDirectories(),
      signal: new AbortController().signal,
      async ask(input) {
        permissions.push(input.permission)
      },
    })

    expect(result).toMatchObject({ filePath, mime: "image/png", modality: "image", inside: true })
    expect(permissions).toEqual(["read"])
  })

  test("copies external media into the Studio imports directory", async () => {
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    const source = path.join(outside, "reference.png")
    await writeFile(source, png)
    const permissions: string[] = []
    const result = await importMediaAsset({
      root: await realpath(root),
      filePath: source,
      outputRoot: await realpath(root),
      outputDirectory: outputDirectories(),
      signal: new AbortController().signal,
      async ask(input) {
        permissions.push(input.permission)
      },
    })

    expect(result.filePath).toStartWith(path.join(await realpath(root), "users/tester/images/reference-"))
    expect(await readFile(result.filePath)).toEqual(png)
    expect(permissions).toEqual(["external_directory", "read", "edit"])
  })

  test("rejects files whose contents are not media", async () => {
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "fake.png"), "not an image")
    await expect(
      importMediaAsset({
        root: await realpath(root),
        filePath: "fake.png",
        outputRoot: await realpath(root),
        outputDirectory: outputDirectories(),
        signal: new AbortController().signal,
        async ask() {},
      }),
    ).rejects.toThrow("Unsupported media file")
  })

  test("reads bounded media bytes for fal upload", async () => {
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "upload.png"), png)
    const result = await readMediaForUpload({
      root: await realpath(root),
      filePath: "upload.png",
      maxBytes: png.length,
      signal: new AbortController().signal,
      async ask() {},
    })
    expect(result).toMatchObject({ mime: "image/png", modality: "image" })
    expect(result.bytes).toEqual(png)
    await expect(
      readMediaForUpload({
        root: await realpath(root),
        filePath: "upload.png",
        maxBytes: png.length - 1,
        signal: new AbortController().signal,
        async ask() {},
      }),
    ).rejects.toThrow("exceeds")
  })
})
