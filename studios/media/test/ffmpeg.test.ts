import { describe, expect, test } from "bun:test"
import { open, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { convertArguments, extractAudioArguments, runMediaProcess, trimArguments } from "../ffmpeg"

describe("FFmpeg process layer", () => {
  test("executes argument arrays without a shell", async () => {
    const result = await runMediaProcess({
      binary: process.execPath,
      args: ["-e", "console.log(process.argv[1])", "value;not-a-command"],
      signal: new AbortController().signal,
    })
    expect(result.stdout.trim()).toBe("value;not-a-command")
  })

  test("passes the validated input descriptor and checks immediately before spawn", async () => {
    const filePath = path.join(import.meta.dir, ".ffmpeg-input")
    await writeFile(filePath, "validated bytes")
    const handle = await open(filePath, "r")
    try {
      await rm(filePath)
      await writeFile(filePath, "replacement bytes")
      let checked = false
      const result = await runMediaProcess({
        binary: process.execPath,
        args: ["-e", 'const fs = require("node:fs"); process.stdout.write(fs.readFileSync("/dev/fd/3", "utf8"))'],
        signal: new AbortController().signal,
        inputFd: handle.fd,
        async beforeSpawn() {
          checked = true
        },
      })
      expect(checked).toBe(true)
      expect(result.stdout).toBe("validated bytes")
    } finally {
      await handle.close()
      await rm(filePath, { force: true })
    }
  })

  test("reports a missing binary clearly", async () => {
    await expect(
      runMediaProcess({
        binary: "/definitely/missing/ffmpeg",
        args: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("install FFmpeg")
  })

  test("builds typed conversion arguments", () => {
    const args = convertArguments({
      source: "/tmp/input;safe.mov",
      output: "/tmp/output.mp4",
      preset: "video-mp4",
      width: 1280,
      quality: 20,
    })
    expect(args).toContain("/tmp/input;safe.mov")
    expect(args).toContain("scale=1280:-2")
    expect(args).toContain("libx264")
    expect(args.at(-1)).toBe("/tmp/output.mp4")
  })

  test("builds accurate trim and extraction arguments", () => {
    expect(
      trimArguments({
        source: "input.mp4",
        output: "output.mp4",
        modality: "video",
        startSeconds: 1.5,
        endSeconds: 4,
      }),
    ).toEqual(expect.arrayContaining(["-ss", "1.5", "-to", "4", "libx264"]))
    expect(extractAudioArguments({ source: "input.mp4", output: "output.wav", format: "wav" })).toEqual(
      expect.arrayContaining(["-vn", "pcm_s16le", "output.wav"]),
    )
  })
})
