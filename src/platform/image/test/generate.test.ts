import { describe, expect, test } from "bun:test"
import { generateImage } from "../generate"

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
)

describe("generateImage fallback", () => {
  test("uses ChatGPT when OAuth is present", async () => {
    const result = await generateImage({
      prompt: "red cube",
      referenceImages: [],
      signal: new AbortController().signal,
      deps: {
        loadChatGPTAuth: async () => ({ access: "tok" }),
        loadXaiAuth: async () => undefined,
        loadFalKey: () => undefined,
        generateChatGPTImage: async () => PNG,
      },
    })
    expect(result.provider).toBe("chatgpt")
    expect(result.mime).toBe("image/png")
  })

  test("falls through to xAI when ChatGPT is missing", async () => {
    const result = await generateImage({
      prompt: "red cube",
      referenceImages: [],
      signal: new AbortController().signal,
      deps: {
        loadChatGPTAuth: async () => undefined,
        loadXaiAuth: async () => ({ token: "tok" }),
        loadFalKey: () => undefined,
        generateXaiImage: async () => PNG,
      },
    })
    expect(result.provider).toBe("xai")
  })

  test("falls through to fal when subscriptions are missing", async () => {
    const result = await generateImage({
      prompt: "red cube",
      referenceImages: [],
      signal: new AbortController().signal,
      deps: {
        loadChatGPTAuth: async () => undefined,
        loadXaiAuth: async () => undefined,
        loadFalKey: () => "fal-key",
        generateFalImage: async () => PNG,
      },
    })
    expect(result.provider).toBe("fal")
  })

  test("falls through when ChatGPT fails", async () => {
    const result = await generateImage({
      prompt: "red cube",
      referenceImages: [],
      signal: new AbortController().signal,
      deps: {
        loadChatGPTAuth: async () => ({ access: "tok" }),
        loadXaiAuth: async () => ({ token: "tok" }),
        loadFalKey: () => undefined,
        generateChatGPTImage: async () => {
          throw new Error("boom")
        },
        generateXaiImage: async () => PNG,
      },
    })
    expect(result.provider).toBe("xai")
  })

  test("does not fall through after abort", async () => {
    const signal = AbortSignal.abort(new Error("cancelled"))
    let xai = 0
    await expect(
      generateImage({
        prompt: "red cube",
        referenceImages: [],
        signal,
        deps: {
          loadChatGPTAuth: async () => ({ access: "tok" }),
          loadXaiAuth: async () => ({ token: "tok" }),
          loadFalKey: () => "fal-key",
          generateChatGPTImage: async () => {
            throw new Error("cancelled")
          },
          generateXaiImage: async () => {
            xai += 1
            return PNG
          },
        },
      }),
    ).rejects.toThrow(/cancelled/)
    expect(xai).toBe(0)
  })

  test("skips xAI when more than three reference images are present", async () => {
    const refs = Array.from({ length: 4 }, () => PNG)
    let xai = 0
    const result = await generateImage({
      prompt: "edit",
      referenceImages: refs,
      signal: new AbortController().signal,
      deps: {
        loadChatGPTAuth: async () => undefined,
        loadXaiAuth: async () => ({ token: "tok" }),
        loadFalKey: () => "fal-key",
        generateXaiImage: async () => {
          xai += 1
          return PNG
        },
        generateFalImage: async () => PNG,
      },
    })
    expect(xai).toBe(0)
    expect(result.provider).toBe("fal")
  })

  test("errors when no provider is configured", async () => {
    await expect(
      generateImage({
        prompt: "red cube",
        referenceImages: [],
        signal: new AbortController().signal,
        deps: {
          loadChatGPTAuth: async () => undefined,
          loadXaiAuth: async () => undefined,
          loadFalKey: () => undefined,
        },
      }),
    ).rejects.toThrow(/No image provider/)
  })
})
