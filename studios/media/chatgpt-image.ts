import { EventSourceParserStream } from "eventsource-parser/stream"
import { fileTypeFromBuffer } from "file-type"
import type { ChatGPTAuth } from "./chatgpt-auth"
import { type AskPermission, readSecureFile } from "./studio-path"

const CODEX_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const SUBSCRIPTION_MODEL = "gpt-5.5"
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_GENERATED_IMAGE_BYTES = 30 * 1024 * 1024

export type ChatGPTImageArgs = {
  prompt: string
  quality: "low" | "medium" | "high" | "auto"
  size?: string
  images?: string[]
}

type CodexEvent = {
  type?: string
  item?: { type?: string; result?: string }
  response?: { error?: { message?: string } }
  error?: { message?: string } | string
  message?: string
}

export function validateImageSize(value: string | undefined) {
  if (value === undefined || value === "auto") return
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) throw new Error(`Invalid image size: ${value}`)
  const width = Number(match[1])
  const height = Number(match[2])
  if (width % 16 !== 0 || height % 16 !== 0 || Math.max(width, height) > 3840) {
    throw new Error(`Image dimensions must be multiples of 16 and at most 3840 pixels: ${value}`)
  }
  const pixels = width * height
  const ratio = Math.max(width / height, height / width)
  if (pixels < 655_360 || pixels > 8_294_400 || ratio > 3) throw new Error(`Image size is outside supported bounds: ${value}`)
}

export async function readReferenceImages(input: { paths: string[] | undefined; root: string; signal: AbortSignal; ask: AskPermission }) {
  const images: string[] = []
  for (const filePath of input.paths ?? []) {
    const file = await readSecureFile({
      root: input.root,
      filePath,
      maxBytes: MAX_REFERENCE_IMAGE_BYTES,
      signal: input.signal,
      ask: input.ask,
    })
    const detected = await fileTypeFromBuffer(file.bytes)
    if (!detected?.mime.startsWith("image/")) throw new Error(`Unsupported reference image: ${file.filePath}`)
    images.push(`data:${detected.mime};base64,${file.bytes.toString("base64")}`)
  }
  return images
}

export async function parseGeneratedImage(stream: ReadableStream<Uint8Array>) {
  const events = (stream as unknown as ReadableStream<BufferSource>)
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
  let failure: string | undefined
  const results: string[] = []
  for await (const event of events) {
    if (event.data === "[DONE]") break
    if (event.data.trim().length === 0) continue
    let value: CodexEvent
    try {
      value = JSON.parse(event.data) as CodexEvent
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("ChatGPT image generation returned a malformed SSE event", { cause: error })
      throw error
    }

    if (value.type === "error" || value.type?.endsWith(".failed")) {
      failure =
        value.response?.error?.message ??
        (typeof value.error === "string" ? value.error : value.error?.message) ??
        value.message ??
        value.type
    }
    if (
      value.type === "response.output_item.done" &&
      value.item?.type === "image_generation_call" &&
      typeof value.item.result === "string" &&
      value.item.result.length > 0
    ) {
      results.push(value.item.result)
    }
  }
  if (failure) throw new Error(`ChatGPT image generation failed: ${failure}`)
  if (results.length === 0) throw new Error("ChatGPT returned no generated image")
  if (results.length > 1) throw new Error(`ChatGPT returned ${results.length} generated images; expected exactly one`)
  return results[0]!
}

export async function generateChatGPTImage(input: {
  auth: ChatGPTAuth
  args: ChatGPTImageArgs
  referenceImages: string[]
  signal: AbortSignal
  fetcher?: typeof fetch
}) {
  validateImageSize(input.args.size)
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: input.args.prompt }]
  for (const image of input.referenceImages) content.push({ type: "input_image", image_url: image })

  const response = await (input.fetcher ?? fetch)(CODEX_RESPONSES_ENDPOINT, {
    method: "POST",
    signal: input.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.auth.access}`,
      ...(input.auth.accountId ? { "ChatGPT-Account-Id": input.auth.accountId } : {}),
      originator: "opencode",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: SUBSCRIPTION_MODEL,
      instructions:
        "You are an image generation assistant running inside the Codex backend. " +
        "Always satisfy the request by invoking the image_generation tool exactly once. Do not respond with text only.",
      input: [{ role: "user", content }],
      tools: [
        {
          type: "image_generation",
          output_format: "png",
          quality: input.args.quality,
          ...(input.args.size ? { size: input.args.size } : {}),
        },
      ],
      tool_choice: { type: "image_generation" },
      stream: true,
      store: false,
    }),
  })
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "")
    throw new Error(`ChatGPT image generation returned ${response.status}: ${detail.slice(0, 500)}`)
  }
  return parseGeneratedImage(response.body)
}

export function decodeGeneratedPng(base64: string) {
  if (base64.length === 0 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("ChatGPT returned invalid base64 image data")
  }
  const bytes = Buffer.from(base64, "base64")
  if (bytes.length === 0 || bytes.length > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error(`Generated image exceeds ${MAX_GENERATED_IMAGE_BYTES} bytes`)
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("ChatGPT output is not a valid PNG")
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width === 0 || height === 0 || width > 3840 || height > 3840 || width * height > 8_294_400) {
    throw new Error(`Generated PNG has invalid dimensions: ${width}x${height}`)
  }
  return { bytes, width, height }
}
