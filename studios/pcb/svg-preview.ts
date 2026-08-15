import { Resvg } from "@resvg/resvg-js"

export const MAX_SVG_PREVIEW_SOURCE_BYTES = 20 * 1024 * 1024
export const MAX_SVG_PREVIEW_BYTES = 4 * 1024 * 1024
export const SVG_PREVIEW_MAX_EDGE = 1200

export type SvgPreview = {
  png: Buffer
  width: number
  height: number
  maxEdge: number
}

function sourceAspectRatio(svg: string): number | null {
  const viewBox = /\bviewBox\s*=\s*["']\s*[-+\d.eE]+[ ,]+[-+\d.eE]+[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)\s*["']/i.exec(svg)
  if (viewBox) {
    const width = Number(viewBox[1])
    const height = Number(viewBox[2])
    if (width > 0 && height > 0) return width / height
  }
  const width = /<svg\b[^>]*\bwidth\s*=\s*["']\s*([-+\d.eE]+)/i.exec(svg)
  const height = /<svg\b[^>]*\bheight\s*=\s*["']\s*([-+\d.eE]+)/i.exec(svg)
  if (!width || !height) return null
  const widthValue = Number(width[1])
  const heightValue = Number(height[1])
  return widthValue > 0 && heightValue > 0 ? widthValue / heightValue : null
}

export function renderSvgPreview(source: Buffer | string): SvgPreview {
  const svg = Buffer.isBuffer(source) ? source.toString("utf8") : source
  const sourceBytes = Buffer.byteLength(svg, "utf8")
  if (sourceBytes > MAX_SVG_PREVIEW_SOURCE_BYTES) {
    throw new Error(`SVG source is ${sourceBytes} bytes; limit is ${MAX_SVG_PREVIEW_SOURCE_BYTES}`)
  }

  const aspect = sourceAspectRatio(svg)
  for (const maxEdge of [SVG_PREVIEW_MAX_EDGE, 900, 600]) {
    const mode = aspect !== null && aspect < 1 ? "height" : "width"
    const image = new Resvg(svg, {
      background: "rgba(255, 255, 255, 1)",
      fitTo: { mode, value: maxEdge },
    }).render()
    const png = Buffer.from(image.asPng())
    if (image.width <= maxEdge && image.height <= maxEdge && png.byteLength <= MAX_SVG_PREVIEW_BYTES) {
      return { png, width: image.width, height: image.height, maxEdge }
    }
  }
  throw new Error(`SVG preview exceeds ${MAX_SVG_PREVIEW_BYTES} bytes or ${SVG_PREVIEW_MAX_EDGE}px after bounded rendering`)
}
