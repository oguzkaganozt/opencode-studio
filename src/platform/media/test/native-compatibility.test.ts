import { describe, expect, test } from "bun:test"
import { decideNativeInput, NATIVE_SUPPORT_MATRIX, nativeCompatibilityError, shouldPatchNativeVideo } from "../native-compatibility"

describe("native input compatibility matrix", () => {
  test("accepts every finite matrix row", () => {
    expect(NATIVE_SUPPORT_MATRIX).toHaveLength(16)
    for (const row of NATIVE_SUPPORT_MATRIX) {
      const decision = decideNativeInput(
        {
          providerID: row.providerID,
          modelID: `model-${row.requestShape}`,
          adapter: row.adapter,
          input: { audio: row.capability === "audio", video: row.capability === "video" },
        },
        row.mime,
      )
      expect(decision).toEqual({ supported: true, row })
    }
  })

  test("rejects provider, model capability, adapter, modality, and format boundaries", () => {
    expect(decideNativeInput(undefined, "video/mp4")).toMatchObject({ supported: false, reason: expect.stringContaining("unknown") })
    expect(
      decideNativeInput(
        {
          providerID: "other",
          modelID: "video-model",
          adapter: "@ai-sdk/openai-compatible",
          input: { audio: false, video: true },
        },
        "video/mp4",
      ),
    ).toMatchObject({ supported: false, reason: expect.stringContaining("other") })
    expect(
      decideNativeInput(
        {
          providerID: "opencode",
          modelID: "text-model",
          adapter: "@ai-sdk/openai-compatible",
          input: { audio: false, video: false },
        },
        "video/mp4",
      ),
    ).toMatchObject({ supported: false, reason: expect.stringContaining("does not declare video") })
    expect(
      decideNativeInput(
        {
          providerID: "opencode",
          modelID: "google-video",
          adapter: "@ai-sdk/google",
          input: { audio: false, video: true },
        },
        "video/mp4",
      ),
    ).toMatchObject({ supported: false, reason: expect.stringContaining("@ai-sdk/google") })
    const anthropicAudio = decideNativeInput(
      {
        providerID: "opencode-go",
        modelID: "anthropic-audio",
        adapter: "@ai-sdk/anthropic",
        input: { audio: true, video: false },
      },
      "audio/wav",
    )
    expect(anthropicAudio).toMatchObject({ supported: false })
    expect(anthropicAudio).not.toHaveProperty("recommendation")
  })

  test("recommends conversion only when a preset reaches a supported matrix format", () => {
    const descriptor = {
      providerID: "opencode",
      modelID: "audio-model",
      adapter: "@ai-sdk/openai-compatible",
      input: { audio: true, video: false },
    }
    expect(decideNativeInput(descriptor, "audio/flac")).toMatchObject({ supported: false, recommendation: "audio-wav" })
    expect(nativeCompatibilityError(descriptor, "audio/flac")?.message).toContain("media_convert preset audio-wav")
    const unknownFormat = decideNativeInput(descriptor, undefined)
    expect(unknownFormat).toMatchObject({ supported: false })
    expect(unknownFormat).not.toHaveProperty("recommendation")
  })

  test("patches only matrix-approved OpenAI-compatible and Anthropic video gateways", () => {
    expect(shouldPatchNativeVideo({ providerID: "opencode", adapter: "@ai-sdk/openai-compatible", video: true })).toBe(true)
    expect(shouldPatchNativeVideo({ providerID: "opencode-go", adapter: "@ai-sdk/anthropic", video: true })).toBe(true)
    expect(shouldPatchNativeVideo({ providerID: "opencode", adapter: "@ai-sdk/google", video: true })).toBe(false)
    expect(shouldPatchNativeVideo({ providerID: "other", adapter: "@ai-sdk/openai-compatible", video: true })).toBe(false)
    expect(shouldPatchNativeVideo({ providerID: "opencode", adapter: "@ai-sdk/openai-compatible", video: false })).toBe(false)
  })
})
