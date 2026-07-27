import { describe, expect, test } from "bun:test"
import { decodeGeneratedPng, generateChatGPTImage, parseGeneratedImage, validateImageSize } from "../chatgpt-image"

function png(width = 1024, height = 1024) {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

describe("ChatGPT subscription image generation", () => {
  test("validates hosted image dimensions", () => {
    expect(() => validateImageSize("1024x1024")).not.toThrow()
    expect(() => validateImageSize("1025x1024")).toThrow("multiples of 16")
    expect(() => validateImageSize("4096x1024")).toThrow("at most 3840")
    expect(() => validateImageSize("bad")).toThrow("Invalid image size")
  })

  test("extracts the generated image from Codex SSE", async () => {
    const stream = new Response(
      'data: {"type":"response.created"}\n\ndata: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"AAAA"}}\n\ndata: [DONE]\n\n',
    ).body!
    expect(await parseGeneratedImage(stream)).toBe("AAAA")
  })

  test("requires exactly one generated image across the complete stream", async () => {
    const none = new Response('data: {"type":"response.completed"}\n\ndata: [DONE]\n\n').body!
    await expect(parseGeneratedImage(none)).rejects.toThrow("no generated image")

    const multiple = new Response(
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"AAAA"}}\n\n' +
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"BBBB"}}\n\n',
    ).body!
    await expect(parseGeneratedImage(multiple)).rejects.toThrow("2 generated images")
  })

  test("treats malformed and provider failure events as fatal", async () => {
    const malformed = new Response("data: {not-json}\n\n").body!
    await expect(parseGeneratedImage(malformed)).rejects.toThrow("malformed SSE event")

    const failureBefore = new Response(
      'data: {"type":"response.failed","response":{"error":{"message":"before image"}}}\n\n' +
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"AAAA"}}\n\n',
    ).body!
    await expect(parseGeneratedImage(failureBefore)).rejects.toThrow("before image")

    const failureAfter = new Response(
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"AAAA"}}\n\n' +
        'data: {"type":"error","error":{"message":"after image"}}\n\ndata: [DONE]\n\n',
    ).body!
    await expect(parseGeneratedImage(failureAfter)).rejects.toThrow("after image")
  })

  test("accepts normal EOF and propagates stream cancellation", async () => {
    const eof = new Response('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"AAAA"}}\n\n').body!
    expect(await parseGeneratedImage(eof)).toBe("AAAA")

    const cancelled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("generation cancelled"))
      },
    })
    await expect(parseGeneratedImage(cancelled)).rejects.toThrow("generation cancelled")
  })

  test("builds an authenticated hosted image request", async () => {
    let request: Request | undefined
    const fetcher = (async (input, init) => {
      request = new Request(input, init)
      return new Response('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"AAAA"}}\n\n')
    }) as typeof fetch
    const result = await generateChatGPTImage({
      auth: { access: "secret", accountId: "account" },
      args: { prompt: "test", quality: "high", size: "1024x1024" },
      referenceImages: ["data:image/png;base64,AAAA"],
      signal: new AbortController().signal,
      fetcher,
    })

    expect(result).toBe("AAAA")
    expect(request?.headers.get("authorization")).toBe("Bearer secret")
    const body = JSON.parse(await request!.text())
    expect(body.tools[0]).toMatchObject({ type: "image_generation", output_format: "png", quality: "high", size: "1024x1024" })
    expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: "data:image/png;base64,AAAA" })
  })

  test("accepts only bounded PNG output", () => {
    const bytes = png(1536, 1024)
    expect(decodeGeneratedPng(bytes.toString("base64"))).toMatchObject({ width: 1536, height: 1024 })
    expect(() => decodeGeneratedPng(Buffer.from("not png").toString("base64"))).toThrow("not a valid PNG")
    expect(() => decodeGeneratedPng("not base64")).toThrow("invalid base64")
  })
})
