import { createFalClient } from "@fal-ai/client"

const ENDPOINT_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/-]+$/
const PLATFORM_URL = "https://api.fal.ai/v1"

export type FalClient = ReturnType<typeof createFalClient>
export type FalPlatformFetcher = (input: URL, init?: RequestInit) => Promise<Response>

export function createVideoClient() {
  return createFalClient()
}

export function requireFalKey() {
  const key = process.env.FAL_KEY?.trim()
  if (!key) throw new Error("FAL_KEY is not set in the OpenCode server environment")
  return key
}

export function falEndpoint(value: string) {
  const endpoint = value.trim()
  if (!ENDPOINT_PATTERN.test(endpoint) || endpoint.includes("..")) {
    throw new Error(`Invalid fal endpoint ID: ${value}`)
  }
  return endpoint
}

export function falRequestID(value: string) {
  const requestID = value.trim()
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestID)) throw new Error(`Invalid fal request ID: ${value}`)
  return requestID
}

/** Always throw an Error with a stable message (Bun/Node AbortSignal reason shapes differ). */
export function throwIfAborted(signal: AbortSignal, fallback = "operation aborted"): void {
  if (!signal.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === "string" && reason.length > 0) throw new Error(reason)
  throw new Error(fallback)
}

export async function falPlatformGet(
  pathname: string,
  params: Record<string, string | number | undefined>,
  fetcher: FalPlatformFetcher = (input, init) => fetch(input, init),
  signal?: AbortSignal,
) {
  if (signal) throwIfAborted(signal, "fal platform request aborted")
  const url = new URL(`${PLATFORM_URL}${pathname}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
  }

  const key = process.env.FAL_KEY?.trim()
  const response = await fetcher(url, {
    signal,
    headers: key ? { Authorization: `Key ${key}` } : undefined,
  })
  if (!response.ok) {
    await response.text().catch(() => "")
    throw new Error(`fal Platform API returned ${response.status}`)
  }
  return response.json()
}

export function formatToolJSON(value: unknown, maxBytes = 60_000) {
  const output = JSON.stringify(value, null, 2)
  if (output.length <= maxBytes) return output
  return `${output.slice(0, maxBytes)}\n... truncated by opencode-studio media (${output.length - maxBytes} characters omitted)`
}
