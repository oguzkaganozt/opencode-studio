import { describe, expect, test } from "bun:test"
import { MAX_SVG_PREVIEW_BYTES, MAX_SVG_PREVIEW_SOURCE_BYTES, renderSvgPreview, SVG_PREVIEW_MAX_EDGE } from "../svg-preview"

function svg(width: number, height: number, content = '<rect width="100%" height="100%" fill="black"/>') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`
}

describe("PCB SVG previews", () => {
  test("renders landscape and portrait SVGs as bounded PNGs", () => {
    for (const source of [svg(800, 600), svg(300, 900)]) {
      const preview = renderSvgPreview(source)
      expect(preview.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
      expect(preview.width).toBeGreaterThan(0)
      expect(preview.height).toBeGreaterThan(0)
      expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(SVG_PREVIEW_MAX_EDGE)
      expect(preview.png.byteLength).toBeLessThanOrEqual(MAX_SVG_PREVIEW_BYTES)
    }
  })

  test("rejects malformed and oversized SVG input deterministically", () => {
    expect(() => renderSvgPreview("not svg")).toThrow()
    expect(() => renderSvgPreview(Buffer.alloc(MAX_SVG_PREVIEW_SOURCE_BYTES + 1, 32))).toThrow(/limit/)
  })
})
