import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { downloadMedia } from "../download"
import { initializeLibrary } from "../library"

const root = path.join(import.meta.dir, ".download-tmp")

function png() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
}

afterEach(() => rm(root, { recursive: true, force: true }))

describe("media downloads", () => {
  test("detects content and writes into workspace media/", async () => {
    await mkdir(root, { recursive: true })
    const library = await initializeLibrary({ root })
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

    expect(path.dirname(result.filePath)).toBe(library.mediaDir)
    expect(result.relativePath).toStartWith("media/download-")
    expect(askedPath).toBe(result.relativePath)
    expect(await readFile(result.filePath)).toEqual(png())
    expect(result.modality).toBe("image")
  })
})
