import { fileTypeFromBuffer } from "file-type"
import { loadChatGPTAuth, loadFalKey, loadXaiAuth } from "./auth"
import { inspectImageBytes } from "./bytes"
import { generateChatGPTImage } from "./chatgpt"
import { generateFalImage } from "./fal"
import { generateXaiImage } from "./xai"

export type ImageProvider = "chatgpt" | "xai" | "fal"

export type GeneratedImage = {
  bytes: Buffer
  mime: string
  extension: string
  width?: number
  height?: number
  provider: ImageProvider
}

export type ImageGenerateDeps = {
  loadChatGPTAuth?: typeof loadChatGPTAuth
  loadXaiAuth?: typeof loadXaiAuth
  loadFalKey?: typeof loadFalKey
  generateChatGPTImage?: typeof generateChatGPTImage
  generateXaiImage?: typeof generateXaiImage
  generateFalImage?: typeof generateFalImage
}

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024

export async function dataUriForImage(bytes: Buffer) {
  const detected = await fileTypeFromBuffer(bytes)
  if (!detected?.mime.startsWith("image/")) throw new Error("Reference file is not an image")
  return `data:${detected.mime};base64,${bytes.toString("base64")}`
}

export function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (!error || typeof error !== "object") return false
  const name = "name" in error ? String(error.name) : ""
  return name === "AbortError" || name === "TimeoutError"
}

export async function generateImage(input: {
  prompt: string
  referenceImages: Buffer[]
  signal: AbortSignal
  deps?: ImageGenerateDeps
}): Promise<GeneratedImage> {
  if (input.prompt.trim().length === 0) throw new Error("prompt is required")
  if (input.referenceImages.length > 10) throw new Error("images supports at most 10 reference files")
  for (const bytes of input.referenceImages) {
    if (bytes.length > MAX_REFERENCE_BYTES) throw new Error(`Reference image exceeds ${MAX_REFERENCE_BYTES} bytes`)
  }
  const references = await Promise.all(input.referenceImages.map((bytes) => dataUriForImage(bytes)))
  const deps = input.deps ?? {}
  const chatgpt = await (deps.loadChatGPTAuth ?? loadChatGPTAuth)()
  const xai = await (deps.loadXaiAuth ?? loadXaiAuth)()
  const falKey = (deps.loadFalKey ?? loadFalKey)()
  const errors: string[] = []

  if (chatgpt) {
    try {
      const bytes = await (deps.generateChatGPTImage ?? generateChatGPTImage)({
        auth: chatgpt,
        prompt: input.prompt,
        referenceImages: references,
        signal: input.signal,
      })
      return { ...inspectImageBytes(bytes), bytes, provider: "chatgpt" }
    } catch (error) {
      if (isAbortError(error, input.signal)) throw error
      errors.push(`chatgpt: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (xai && references.length <= 3) {
    try {
      const bytes = await (deps.generateXaiImage ?? generateXaiImage)({
        auth: xai,
        prompt: input.prompt,
        referenceImages: references,
        signal: input.signal,
      })
      return { ...inspectImageBytes(bytes), bytes, provider: "xai" }
    } catch (error) {
      if (isAbortError(error, input.signal)) throw error
      errors.push(`xai: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (falKey) {
    try {
      const bytes = await (deps.generateFalImage ?? generateFalImage)({
        key: falKey,
        prompt: input.prompt,
        referenceImages: references,
        signal: input.signal,
      })
      return { ...inspectImageBytes(bytes), bytes, provider: "fal" }
    } catch (error) {
      if (isAbortError(error, input.signal)) throw error
      errors.push(`fal: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length === 0) {
    throw new Error("No image provider is available. Connect ChatGPT or xAI in OpenCode, or set FAL_KEY.")
  }
  throw new Error(`image_generate failed. ${errors.join(" | ")}`)
}
