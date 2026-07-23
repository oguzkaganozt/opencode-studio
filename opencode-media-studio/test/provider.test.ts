import { describe, expect, test } from "bun:test"
import { NATIVE_SUPPORT_MATRIX } from "../src/native-compatibility"
import { createNativeMediaProvider } from "../src/provider"
import { rewriteAnthropicVideoRequestBody, rewritePromptVideos, rewriteVideoRequestBody } from "../src/provider-internal"

describe("native video provider adapters", () => {
  test("emits the pinned AI SDK request shape for every support-matrix row", async () => {
    for (const row of NATIVE_SUPPORT_MATRIX) {
      let requestBody: any
      const anthropic = row.requestShape === "anthropic-video"
      const provider = createNativeMediaProvider({
        ...(anthropic ? { nativeMediaProtocol: "anthropic" as const, apiKey: "test" } : { name: "test" }),
        baseURL: "https://example.test/v1",
        fetch: (async (_url, init) => {
          requestBody = JSON.parse(String(init?.body))
          return anthropic
            ? new Response(
                'event: message_start\ndata: {"type":"message_start","message":{"id":"response","type":"message","role":"assistant","content":[],"model":"test-model","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
                { headers: { "content-type": "text/event-stream" } },
              )
            : new Response('data: {"id":"response","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
                headers: { "content-type": "text/event-stream" },
              })
        }) as typeof fetch,
      })
      const model = provider.languageModel("test-model")
      await model.doStream({
        prompt: [
          {
            role: "user",
            content: [
              { type: "text", text: `${row.providerID}:${row.mime}` },
              { type: "file", mediaType: row.mime, data: "AAAA" },
            ],
          },
        ],
      } as never)

      const part = requestBody.messages[0].content[1]
      if (row.requestShape === "openai-input-audio") {
        expect(part).toEqual({
          type: "input_audio",
          input_audio: { data: "AAAA", format: row.mime === "audio/wav" ? "wav" : "mp3" },
        })
      } else if (row.requestShape === "openai-video-url") {
        expect(part).toEqual({ type: "video_url", video_url: { url: `data:${row.mime};base64,AAAA` } })
      } else {
        expect(part).toEqual({ type: "video", source: { type: "base64", media_type: row.mime, data: "AAAA" } })
      }
    }
  })

  test("confirms pinned Anthropic rejects standalone audio", async () => {
    let requests = 0
    const provider = createNativeMediaProvider({
      nativeMediaProtocol: "anthropic",
      apiKey: "test",
      baseURL: "https://example.test/v1",
      fetch: (async () => {
        requests += 1
        throw new Error("must reject before transport")
      }) as unknown as typeof fetch,
    })
    await expect(
      provider.languageModel("audio-model").doStream({
        prompt: [{ role: "user", content: [{ type: "file", mediaType: "audio/wav", data: "AAAA" }] }],
      } as never),
    ).rejects.toThrow("media type: audio/wav")
    expect(requests).toBe(0)
  })

  test("marks video file parts for the upstream converter", () => {
    const result = rewritePromptVideos({
      prompt: [{ role: "user", content: [{ type: "file", mediaType: "video/mp4", data: "AAAA" }] }],
    })
    expect(result.prompt[0]!.content[0]!.mediaType).toBe("image/x-opencode-video-mp4")
  })

  test("rewrites only marked image_url parts to video_url", () => {
    const result = rewriteVideoRequestBody({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/x-opencode-video-webm;base64,AAAA" } },
            { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
          ],
        },
      ],
    })
    expect(result.messages[0]!.content).toEqual([
      { type: "video_url", video_url: { url: "data:video/webm;base64,AAAA" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
    ])
  })

  test("rewrites only marked Anthropic image blocks to video blocks", () => {
    const result = rewriteAnthropicVideoRequestBody({
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/x-opencode-video-mp4", data: "AAAA" } },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "BBBB" } },
          ],
        },
      ],
    })
    expect(result.messages[0]!.content).toEqual([
      { type: "video", source: { type: "base64", media_type: "video/mp4", data: "AAAA" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "BBBB" } },
    ])
  })

  test("emits video_url through the real AI SDK provider", async () => {
    let requestBody: any
    const provider = createNativeMediaProvider({
      name: "test",
      baseURL: "https://example.test/v1",
      fetch: (async (_url, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response('data: {"id":"response","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          headers: { "content-type": "text/event-stream" },
        })
      }) as typeof fetch,
    })
    const model = provider.languageModel("video-model")

    await model.doStream({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this video" },
            { type: "file", mediaType: "video/mp4", data: "AAAA" },
          ],
        },
      ],
    } as never)

    expect(requestBody.messages[0].content[1]).toEqual({
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,AAAA" },
    })
  })

  test("emits a video block through the real Anthropic SDK provider", async () => {
    let requestBody: any
    const provider = createNativeMediaProvider({
      nativeMediaProtocol: "anthropic",
      apiKey: "test",
      baseURL: "https://example.test/v1",
      fetch: (async (_url, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          'event: message_start\ndata: {"type":"message_start","message":{"id":"response","type":"message","role":"assistant","content":[],"model":"video-model","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        )
      }) as typeof fetch,
    })
    const model = provider.languageModel("video-model")

    await model.doStream({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this video" },
            { type: "file", mediaType: "video/mp4", data: "AAAA" },
          ],
        },
      ],
    } as never)

    expect(requestBody.messages[0].content[1]).toEqual({
      type: "video",
      source: { type: "base64", media_type: "video/mp4", data: "AAAA" },
    })
  })
})
