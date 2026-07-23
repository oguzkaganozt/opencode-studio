import { afterEach, describe, expect, test } from "bun:test"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { downloadMedia } from "../src/download"
import { initializeLibrary } from "../src/library"

const root = path.join(import.meta.dir, ".download-tmp")

function png() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
}

afterEach(() => rm(root, { recursive: true, force: true }))

describe("media downloads", () => {
  test("detects content and routes an allowlisted response into personal space", async () => {
    const library = await initializeLibrary({ root, resolveUsername: () => "tester" })
    let askedPath = ""
    const result = await downloadMedia({
      url: "https://cdn.fal.media/generated/without-extension",
      library,
      allowedHosts: ["fal.media"],
      maxBytes: 100,
      signal: new AbortController().signal,
      async ask(input) {
        askedPath = input.patterns[0]!
      },
      fetcher: (async () =>
        new Response(png(), {
          headers: { "content-length": String(png().length), "content-type": "image/png" },
        })) as unknown as typeof fetch,
    })

    expect(path.dirname(result.filePath)).toBe(library.personal.image)
    expect(result.relativePath).toStartWith("users/tester/images/download-")
    expect(askedPath).toBe(result.relativePath)
    expect(await readFile(result.filePath)).toEqual(png())
    expect(result.modality).toBe("image")
  })

  test("rejects hosts and destinations outside personal modality space", async () => {
    const library = await initializeLibrary({ root, resolveUsername: () => "tester" })
    const common = {
      library,
      allowedHosts: ["fal.media"],
      maxBytes: 100,
      signal: new AbortController().signal,
      async ask() {},
      fetcher: (async () => new Response(png())) as unknown as typeof fetch,
    }
    await expect(downloadMedia({ ...common, url: "https://example.test/video.mp4" })).rejects.toThrow("host is not allowed")
    await expect(downloadMedia({ ...common, url: "https://fal.media/image", outputPath: "../image.png" })).rejects.toThrow(
      "current user's images",
    )
  })

  test("preserves collisions and removes oversized staging files", async () => {
    const library = await initializeLibrary({ root, resolveUsername: () => "tester" })
    const common = {
      url: "https://fal.media/image",
      library,
      allowedHosts: ["fal.media"],
      signal: new AbortController().signal,
      async ask() {},
    }
    await expect(
      downloadMedia({
        ...common,
        maxBytes: 3,
        fetcher: (async () => new Response(Buffer.from("too large"))) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("exceeded")
    expect((await readdir(path.dirname(library.personal.image))).filter((entry) => entry.startsWith(".download-"))).toEqual([])

    const existing = path.join(library.personal.image, "existing.png")
    await writeFile(existing, "original")
    await expect(
      downloadMedia({
        ...common,
        outputPath: "existing.png",
        maxBytes: 100,
        fetcher: (async () => new Response(png())) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("already exists")
    expect(await readFile(existing, "utf8")).toBe("original")
    expect((await readdir(path.dirname(library.personal.image))).filter((entry) => entry.startsWith(".download-"))).toEqual([])
  })
})
