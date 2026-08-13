import type { XaiAuth } from "./auth"

const GENERATE_URL = "https://api.x.ai/v1/images/generations"
const EDIT_URL = "https://api.x.ai/v1/images/edits"
const MODEL = "grok-imagine-image-quality"

type XaiImage = { b64_json?: string; url?: string }

export async function generateXaiImage(input: {
  auth: XaiAuth
  prompt: string
  referenceImages: string[]
  signal: AbortSignal
  fetcher?: typeof fetch
}) {
  const editing = input.referenceImages.length > 0
  const refs = input.referenceImages.slice(0, 3)
  const body = editing
    ? {
        model: MODEL,
        prompt: input.prompt,
        image: refs.length === 1 ? { url: refs[0], type: "image_url" } : refs.map((url) => ({ url, type: "image_url" })),
        response_format: "b64_json",
      }
    : {
        model: MODEL,
        prompt: input.prompt,
        n: 1,
        response_format: "b64_json",
      }
  const response = await (input.fetcher ?? fetch)(editing ? EDIT_URL : GENERATE_URL, {
    method: "POST",
    signal: input.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.auth.token}`,
    },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`xAI image generation returned ${response.status}: ${raw.slice(0, 400)}`)
  let parsed: { data?: XaiImage[] }
  try {
    parsed = JSON.parse(raw) as { data?: XaiImage[] }
  } catch (error) {
    throw new Error("xAI image generation returned invalid JSON", { cause: error })
  }
  const first = parsed.data?.[0]
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64")
  if (first?.url) {
    const image = await (input.fetcher ?? fetch)(first.url, { signal: input.signal })
    if (!image.ok) throw new Error(`xAI image download returned ${image.status}`)
    return Buffer.from(await image.arrayBuffer())
  }
  throw new Error("xAI returned no generated image")
}
