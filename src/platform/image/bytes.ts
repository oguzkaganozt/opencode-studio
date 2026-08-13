const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_BYTES = 30 * 1024 * 1024

export function inspectImageBytes(bytes: Buffer) {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`Generated image exceeds ${MAX_BYTES} bytes`)
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG) && bytes.toString("ascii", 12, 16) === "IHDR") {
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width === 0 || height === 0 || width > 3840 || height > 3840) {
      throw new Error(`Generated PNG has invalid dimensions: ${width}x${height}`)
    }
    return { mime: "image/png", extension: ".png", width, height }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extension: ".jpg" }
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", extension: ".webp" }
  }
  throw new Error("Generated output is not a PNG, JPEG, or WebP image")
}
