import { describe, expect, test } from "bun:test"
import { concatListBody, concatVideoArguments, cropImageArguments } from "../ffmpeg"

describe("media ffmpeg args", () => {
  test("crop image args", () => {
    expect(cropImageArguments({ source: "/dev/fd/3", output: "out.png", x: 10, y: 20, width: 100, height: 50, format: "png" })).toEqual([
      "-nostdin",
      "-hide_banner",
      "-n",
      "-i",
      "/dev/fd/3",
      "-vf",
      "crop=100:50:10:20",
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "out.png",
    ])
  })

  test("concat list escapes single quotes", () => {
    expect(concatListBody(["/tmp/a'b.mp4", "/tmp/c.mp4"])).toBe("file '/tmp/a'\\''b.mp4'\nfile '/tmp/c.mp4'\n")
  })

  test("concat video args", () => {
    const args = concatVideoArguments({ listPath: "/tmp/list.txt", output: "out.mp4" })
    expect(args.slice(0, 8)).toEqual(["-nostdin", "-hide_banner", "-n", "-f", "concat", "-safe", "0", "-i"])
    expect(args.at(-1)).toBe("out.mp4")
  })
})
