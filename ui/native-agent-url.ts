/** URL-safe base64 without padding (OpenCode directory / server-key encoding). */
export function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64")
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

/** Native OpenCode home (workspace root UI). */
export function nativeOpenCodeHomeUrl(): string {
  return "/"
}

/**
 * Prefill a new-session composer without auto-submit.
 * OpenCode consumes `?prompt=` on the legacy directory session route and redirects to a draft.
 */
export function nativePromptDraftUrl(workspace: string, prompt: string): string {
  const text = prompt.trim()
  if (!text) return nativeOpenCodeHomeUrl()
  const dir = encodeBase64Url(workspace)
  return `/${dir}/session?prompt=${encodeURIComponent(text)}`
}
