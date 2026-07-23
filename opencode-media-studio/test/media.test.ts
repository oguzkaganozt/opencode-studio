import { describe, expect, test } from "bun:test"
import { hasPlausibleSignature, mediaMime, mediaModality } from "../src/media"

describe("media detection", () => {
  test("maps supported extensions without mistaking TypeScript for transport stream video", () => {
    expect(mediaMime("clip.mp4")).toBe("video/mp4")
    expect(mediaMime("voice.mp3")).toBe("audio/mp3")
    expect(mediaMime("source.ts")).toBeUndefined()
  })

  test("maps MIME types to model modalities", () => {
    expect(mediaModality("video/webm")).toBe("video")
    expect(mediaModality("audio/wav")).toBe("audio")
    expect(mediaModality("application/pdf")).toBeUndefined()
  })

  test("checks representative container signatures", () => {
    expect(hasPlausibleSignature("video/mp4", Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]))).toBe(true)
    expect(hasPlausibleSignature("audio/mp3", Buffer.from("ID3\u0004"))).toBe(true)
    expect(hasPlausibleSignature("audio/wav", Buffer.from("RIFF0000WAVE"))).toBe(true)
    expect(hasPlausibleSignature("video/quicktime", Buffer.from([0, 0, 0, 12, 0x6d, 0x6f, 0x6f, 0x76, 1, 2, 3, 4]))).toBe(true)
    expect(hasPlausibleSignature("video/mp4", Buffer.from("not a video"))).toBe(false)
  })
})
