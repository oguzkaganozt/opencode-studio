import { describe, expect, test } from "bun:test"
import { createMediaSelection, createMediaSelectionHandoff, mediaSelectionAnnotation } from "./selection"

describe("media selection", () => {
  test("builds image bbox selection", () => {
    const selection = createMediaSelection({
      modality: "image",
      path: "media/shot.png",
      spatial: { x: 10.4, y: 20.6, w: 100.2, h: 50.9 },
    })
    expect(selection).toEqual({
      modality: "image",
      path: "media/shot.png",
      spatial: { x: 10, y: 21, w: 100, h: 51 },
      temporal: undefined,
      summary: "image · bbox 10,21 100×51",
    })
    expect(mediaSelectionAnnotation(selection!)).toContain("bbox_px=x=10 y=21 w=100 h=51")
  })

  test("rejects invalid temporal range", () => {
    expect(createMediaSelection({ modality: "video", path: "a.mp4", temporal: { start: 5, end: 5 } })).toBeNull()
  })

  test("handoff includes path and annotation", () => {
    const selection = createMediaSelection({
      modality: "video",
      path: "media/clip.mp4",
      temporal: { start: 1, end: 3.5 },
    })!
    const handoff = createMediaSelectionHandoff("/tmp/project", selection)
    expect(handoff.paths).toEqual(["media/clip.mp4"])
    expect(handoff.annotation).toContain("time_s=start=1.00 end=3.50")
    expect(handoff.text).toContain("media_trim")
  })
})
