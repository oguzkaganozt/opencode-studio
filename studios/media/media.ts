import path from "node:path"

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  ".aac": "audio/aac",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mp3",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
}

export type MediaModality = "audio" | "video"

export function mediaMime(filePath: string) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]
}

export function mediaModality(mime: string): MediaModality | undefined {
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
}

export function hasPlausibleSignature(mime: string, bytes: Uint8Array) {
  const ascii = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString("ascii")
  if (mime === "video/mp4" || mime === "video/quicktime" || mime === "audio/mp4") {
    let offset = 0
    while (offset + 8 <= bytes.length) {
      const size = Buffer.from(bytes.subarray(offset, offset + 4)).readUInt32BE()
      const type = ascii(offset + 4, offset + 8)
      if (["ftyp", "moov", "mdat"].includes(type)) return true
      if (size < 8 || offset + size > bytes.length) return false
      offset += size
    }
    return false
  }
  if (mime === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  if (mime === "audio/wav") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
  if (mime === "audio/aiff") return ascii(0, 4) === "FORM" && ["AIFF", "AIFC"].includes(ascii(8, 12))
  if (mime === "audio/flac") return ascii(0, 4) === "fLaC"
  if (mime === "audio/ogg") return ascii(0, 4) === "OggS"
  if (mime === "audio/mp3") {
    return ascii(0, 3) === "ID3" || (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0)
  }
  if (mime === "audio/aac") return bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xf6) === 0xf0
  return false
}

export function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
