import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createMediaStudioPlugin } from "../tools"

const root = path.join(import.meta.dir, ".tmp-ffmpeg-output")
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("FFmpeg output ownership", () => {
  test("concurrent mutations cannot remove the output published by the winner", async () => {
    const domainRoot = path.join(root, "projects")
    const projectRoot = path.join(domainRoot, "demo")
    const mediaDir = path.join(projectRoot, "media")
    const source = path.join(mediaDir, "source.png")
    const fakeFfmpeg = path.join(root, "fake-ffmpeg.sh")
    await mkdir(mediaDir, { recursive: true })
    await writeFile(source, png)
    await writeFile(fakeFfmpeg, `#!/bin/sh\nout=""\nfor arg in "$@"; do out="$arg"; done\nsleep 0.05\ncp "${source}" "$out"\n`)
    await chmod(fakeFfmpeg, 0o700)

    let arrivals = 0
    let release: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const plugin = createMediaStudioPlugin({
      beforeMediaSpawn: async () => {
        arrivals += 1
        if (arrivals === 2) release?.()
        await barrier
      },
    })
    const hooks = await plugin(
      {
        directory: root,
        worktree: root,
        client: { provider: { list: async () => ({ data: { all: [] } }) } },
      } as never,
      { libraryRoot: domainRoot, ffmpegPath: fakeFfmpeg },
    )
    const context = { directory: projectRoot, abort: new AbortController().signal, ask: async () => {} } as never
    const execute = () =>
      (hooks.tool as any).media_convert.execute(
        { filePath: "media/source.png", preset: "image-png", outputPath: "media/shared.png" },
        context,
      )

    const results = await Promise.allSettled([execute(), execute()])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(await readFile(path.join(mediaDir, "shared.png"))).toEqual(png)
    expect((await Array.fromAsync(new Bun.Glob(".*.tmp.png").scan(mediaDir))).length).toBe(0)
  })
})
