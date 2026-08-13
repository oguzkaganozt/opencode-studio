const GENERATE_ENDPOINT = "fal-ai/nano-banana-2"
const EDIT_ENDPOINT = "fal-ai/nano-banana-2/edit"

type FalImage = { url?: string }

function abortableSleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("fal image generation aborted"))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error("fal image generation aborted"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

async function falJson(input: { key: string; url: string; method?: string; body?: unknown; signal: AbortSignal; fetcher?: typeof fetch }) {
  const response = await (input.fetcher ?? fetch)(input.url, {
    method: input.method ?? "GET",
    signal: input.signal,
    headers: {
      Authorization: `Key ${input.key}`,
      Accept: "application/json",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`fal returned ${response.status}: ${raw.slice(0, 400)}`)
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    throw new Error("fal returned invalid JSON", { cause: error })
  }
}

export async function generateFalImage(input: {
  key: string
  prompt: string
  referenceImages: string[]
  signal: AbortSignal
  fetcher?: typeof fetch
}) {
  const editing = input.referenceImages.length > 0
  const endpoint = editing ? EDIT_ENDPOINT : GENERATE_ENDPOINT
  const queued = await falJson({
    key: input.key,
    url: `https://queue.fal.run/${endpoint}`,
    method: "POST",
    body: editing
      ? { prompt: input.prompt, image_urls: input.referenceImages, num_images: 1, resolution: "1K" }
      : { prompt: input.prompt, num_images: 1, resolution: "1K" },
    signal: input.signal,
    fetcher: input.fetcher,
  })
  const statusUrl = typeof queued.status_url === "string" ? queued.status_url : undefined
  const responseUrl = typeof queued.response_url === "string" ? queued.response_url : undefined
  if (!statusUrl || !responseUrl) throw new Error("fal queue did not return status_url/response_url")

  for (let attempt = 0; attempt < 90; attempt++) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error("fal image generation aborted")
    const status = await falJson({ key: input.key, url: statusUrl, signal: input.signal, fetcher: input.fetcher })
    const state = typeof status.status === "string" ? status.status : ""
    if (state === "COMPLETED" || state === "OK") {
      const result = await falJson({ key: input.key, url: responseUrl, signal: input.signal, fetcher: input.fetcher })
      const images = Array.isArray(result.images) ? (result.images as FalImage[]) : []
      const url = images[0]?.url
      if (!url) throw new Error("fal returned no generated image")
      const image = await (input.fetcher ?? fetch)(url, { signal: input.signal })
      if (!image.ok) throw new Error(`fal image download returned ${image.status}`)
      return Buffer.from(await image.arrayBuffer())
    }
    if (state === "FAILED" || state === "ERROR") {
      throw new Error(`fal image generation failed: ${JSON.stringify(status).slice(0, 300)}`)
    }
    await abortableSleep(1000, input.signal)
  }
  throw new Error("fal image generation timed out")
}
