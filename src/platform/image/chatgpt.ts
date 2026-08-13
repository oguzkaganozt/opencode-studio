import { EventSourceParserStream } from "eventsource-parser/stream"
import type { ChatGPTAuth } from "./auth"

const CODEX_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const SUBSCRIPTION_MODEL = "gpt-5.5"

type CodexEvent = {
  type?: string
  item?: { type?: string; result?: string }
  response?: { error?: { message?: string } }
  error?: { message?: string } | string
  message?: string
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
  return Buffer.from(results[0]!, "base64")
}

export async function generateChatGPTImage(input: {
  auth: ChatGPTAuth
  prompt: string
  referenceImages: string[]
  signal: AbortSignal
  fetcher?: typeof fetch
}) {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: input.prompt }]
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
          model: "gpt-image-2",
          output_format: "png",
          quality: "high",
          action: input.referenceImages.length > 0 ? "edit" : "generate",
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
