const VIDEO_MARKERS = new Map([
  ["video/mp4", "image/x-opencode-video-mp4"],
  ["video/webm", "image/x-opencode-video-webm"],
  ["video/quicktime", "image/x-opencode-video-quicktime"],
])

const VIDEO_MIMES = new Map(Array.from(VIDEO_MARKERS, ([mime, marker]) => [marker, mime]))

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function rewritePromptVideos(options: unknown): any {
  if (!isRecord(options) || !Array.isArray(options.prompt)) return options

  return {
    ...options,
    prompt: options.prompt.map((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) return message
      return {
        ...message,
        content: message.content.map((part) => {
          if (!isRecord(part) || part.type !== "file" || typeof part.mediaType !== "string") return part
          const marker = VIDEO_MARKERS.get(part.mediaType.toLowerCase())
          return marker ? { ...part, mediaType: marker } : part
        }),
      }
    }),
  }
}

export function rewriteVideoRequestBody(body: unknown): any {
  if (!isRecord(body) || !Array.isArray(body.messages)) return body

  return {
    ...body,
    messages: body.messages.map((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) return message
      return {
        ...message,
        content: message.content.map((part) => {
          if (!isRecord(part) || part.type !== "image_url" || !isRecord(part.image_url)) return part
          const url = part.image_url.url
          if (typeof url !== "string") return part
          const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
          if (!match) return part
          const mime = VIDEO_MIMES.get(match[1]!.toLowerCase())
          if (!mime) return part
          const { image_url: imageUrl, ...rest } = part
          return {
            ...rest,
            type: "video_url",
            video_url: {
              ...imageUrl,
              url: `data:${mime};base64,${match[2]}`,
            },
          }
        }),
      }
    }),
  }
}

export function rewriteAnthropicVideoRequestBody(body: unknown): any {
  if (!isRecord(body) || !Array.isArray(body.messages)) return body

  return {
    ...body,
    messages: body.messages.map((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) return message
      return {
        ...message,
        content: message.content.map((part) => {
          if (!isRecord(part) || part.type !== "image" || !isRecord(part.source)) return part
          const mediaType = part.source.media_type
          if (typeof mediaType !== "string") return part
          const mime = VIDEO_MIMES.get(mediaType.toLowerCase())
          if (!mime) return part
          return {
            ...part,
            type: "video",
            source: { ...part.source, media_type: mime },
          }
        }),
      }
    }),
  }
}
