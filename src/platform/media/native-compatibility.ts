export type NativeAdapter = "@ai-sdk/openai-compatible" | "@ai-sdk/anthropic"
export type NativeModality = "audio" | "video"
export type NativeRequestShape = "openai-input-audio" | "openai-video-url" | "anthropic-video"

export type NativeSessionDescriptor = {
  providerID: string
  modelID: string
  adapter: string
  input: { audio: boolean; video: boolean }
}

export type NativeSupportRow = {
  providerID: "opencode" | "opencode-go"
  capability: NativeModality
  adapter: NativeAdapter
  modality: NativeModality
  mime: string
  requestShape: NativeRequestShape
  patchAdapter: boolean
}

const PROVIDERS = ["opencode", "opencode-go"] as const
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"] as const
const AUDIO_MIMES = ["audio/wav", "audio/mp3"] as const

export const NATIVE_SUPPORT_MATRIX: readonly NativeSupportRow[] = [
  ...PROVIDERS.flatMap((providerID) =>
    AUDIO_MIMES.map((mime) => ({
      providerID,
      capability: "audio" as const,
      adapter: "@ai-sdk/openai-compatible" as const,
      modality: "audio" as const,
      mime,
      requestShape: "openai-input-audio" as const,
      patchAdapter: false,
    })),
  ),
  ...PROVIDERS.flatMap((providerID) =>
    VIDEO_MIMES.map((mime) => ({
      providerID,
      capability: "video" as const,
      adapter: "@ai-sdk/openai-compatible" as const,
      modality: "video" as const,
      mime,
      requestShape: "openai-video-url" as const,
      patchAdapter: true,
    })),
  ),
  ...PROVIDERS.flatMap((providerID) =>
    VIDEO_MIMES.map((mime) => ({
      providerID,
      capability: "video" as const,
      adapter: "@ai-sdk/anthropic" as const,
      modality: "video" as const,
      mime,
      requestShape: "anthropic-video" as const,
      patchAdapter: true,
    })),
  ),
]

export function nativeModality(mime: string): NativeModality | undefined {
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
}

export function shouldPatchNativeVideo(input: { providerID: string; adapter: string; video: boolean }) {
  return (
    input.video &&
    NATIVE_SUPPORT_MATRIX.some(
      (row) => row.providerID === input.providerID && row.adapter === input.adapter && row.modality === "video" && row.patchAdapter,
    )
  )
}

export type NativeCompatibilityDecision =
  | {
      supported: true
      row: NativeSupportRow
    }
  | {
      supported: false
      reason: string
      recommendation?: "video-mp4" | "audio-wav"
    }

export function decideNativeInput(descriptor: NativeSessionDescriptor | undefined, mime: string | undefined): NativeCompatibilityDecision {
  if (!descriptor) return { supported: false, reason: "the selected session model is unknown" }
  if (!descriptor.modelID) return { supported: false, reason: "the selected model has no model ID" }
  if (!mime) return { supported: false, reason: "the file extension does not identify a detected native media format" }
  const modality = nativeModality(mime)
  if (!modality) return { supported: false, reason: `detected format ${mime} is not audio or video` }
  if (!descriptor.input[modality]) {
    return { supported: false, reason: `model ${descriptor.modelID} does not declare ${modality} input capability` }
  }

  const row = NATIVE_SUPPORT_MATRIX.find(
    (candidate) =>
      candidate.providerID === descriptor.providerID &&
      candidate.adapter === descriptor.adapter &&
      candidate.modality === modality &&
      candidate.mime === mime,
  )
  if (row) return { supported: true, row }

  const convertible = NATIVE_SUPPORT_MATRIX.find(
    (candidate) =>
      candidate.providerID === descriptor.providerID && candidate.adapter === descriptor.adapter && candidate.modality === modality,
  )
  return {
    supported: false,
    reason: `model ${descriptor.modelID} on ${descriptor.providerID} with adapter ${descriptor.adapter} does not support ${mime}`,
    ...(convertible ? { recommendation: modality === "video" ? ("video-mp4" as const) : ("audio-wav" as const) } : {}),
  }
}

export function nativeCompatibilityError(descriptor: NativeSessionDescriptor | undefined, mime: string | undefined) {
  const decision = decideNativeInput(descriptor, mime)
  if (decision.supported) return
  const recommendation = decision.recommendation
    ? ` Convert the asset explicitly with media_convert preset ${decision.recommendation}, then retry.`
    : ""
  return new Error(`read_media rejected native input before file loading: ${decision.reason}.${recommendation}`)
}
