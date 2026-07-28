/** Safe http(s) URL for viewer links; rejects javascript:/data:/etc. */
export function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}
