/** Token / TPS helpers for the agent panel footer (inspired by opencode-tps-meter). */

export type TokenBucket = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type StreamSample = { at: number; tokens: number }

export type UsageMessage = {
  role: string
  id: string
  parentID?: string
  cost?: number
  tokens?: TokenBucket
  time: { created: number; completed?: number }
}

export const STREAM_WINDOW_MS = 15_000
export const ACTIVE_GAP_MS = 1_250
export const LIVE_STALE_MS = 1_500
export const SINGLE_SAMPLE_MS = 1_000
export const MAX_MESSAGE_SAMPLES = 4_096
export const MAX_TRACKED_MESSAGES = 24

export function estimateStreamTokens(chars: number): number {
  return Math.max(0, Math.round(Math.max(0, chars) / 4))
}

export function tokenTotal(tokens: TokenBucket | undefined): number {
  if (!tokens) return 0
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function activeDurationMs(samples: StreamSample[], tailAt?: number): number {
  if (samples.length === 0) return 0
  if (samples.length === 1) {
    const tailDuration = tailAt ? Math.max(0, tailAt - samples[0]!.at) : SINGLE_SAMPLE_MS
    return Math.min(Math.max(tailDuration, 250), SINGLE_SAMPLE_MS)
  }

  let duration = 0
  for (let i = 1; i < samples.length; i++) {
    duration += Math.min(Math.max(0, samples[i]!.at - samples[i - 1]!.at), ACTIVE_GAP_MS)
  }

  if (tailAt) {
    duration += Math.min(Math.max(0, tailAt - samples[samples.length - 1]!.at), ACTIVE_GAP_MS)
  }

  return Math.max(duration, SINGLE_SAMPLE_MS)
}

export function truncateTrackedMessages(stats: Record<string, StreamSample[]>): Record<string, StreamSample[]> {
  const entries = Object.entries(stats)
  if (entries.length <= MAX_TRACKED_MESSAGES) return stats
  const trimmed = entries.sort((a, b) => (b[1][b[1].length - 1]?.at ?? 0) - (a[1][a[1].length - 1]?.at ?? 0)).slice(0, MAX_TRACKED_MESSAGES)
  return Object.fromEntries(trimmed)
}

export function pruneStreamSamples(samples: StreamSample[], now = Date.now()): StreamSample[] {
  return samples.filter((sample) => now - sample.at <= STREAM_WINDOW_MS)
}

export function appendStreamSample(samples: StreamSample[], sample: StreamSample): StreamSample[] {
  return [...pruneStreamSamples(samples, sample.at), sample]
}

export function appendMessageSample(
  stats: Record<string, StreamSample[]>,
  messageID: string,
  sample: StreamSample,
): Record<string, StreamSample[]> {
  return truncateTrackedMessages({
    ...stats,
    [messageID]: [...(stats[messageID] ?? []), sample].slice(-MAX_MESSAGE_SAMPLES),
  })
}

export function liveTpsValue(samples: StreamSample[], now = Date.now()): number | undefined {
  const relevant = samples.filter((sample) => now - sample.at <= STREAM_WINDOW_MS)
  if (relevant.length === 0) return undefined
  const lastSample = relevant[relevant.length - 1]
  if (!lastSample || now - lastSample.at > LIVE_STALE_MS) return undefined
  const total = relevant.reduce((sum, sample) => sum + sample.tokens, 0)
  const durationSeconds = activeDurationMs(relevant, now) / 1000
  if (durationSeconds <= 0) return undefined
  const value = total / durationSeconds
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function exactTpsValue(tokens: number, durationMs: number): number | undefined {
  if (!(tokens > 0) || !(durationMs > 0)) return undefined
  const value = tokens / (durationMs / 1000)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function sessionUsageTotals(messages: UsageMessage[]): {
  tokens: number
  cost: number
  last?: UsageMessage & { tokens: TokenBucket }
} {
  let tokens = 0
  let cost = 0
  let last: (UsageMessage & { tokens: TokenBucket }) | undefined
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const total = tokenTotal(msg.tokens)
    if (total > 0 && msg.tokens) {
      tokens += total
      last = msg as UsageMessage & { tokens: TokenBucket }
    }
    if (typeof msg.cost === "number" && Number.isFinite(msg.cost)) cost += msg.cost
  }
  return { tokens, cost, last }
}

/** Wall-clock duration for a completed assistant turn (user prompt → assistant done). */
export function assistantWallMs(messages: UsageMessage[], assistant: UsageMessage): number {
  const user = messages.find((item) => item.role === "user" && item.id === assistant.parentID)
  const start = user?.time.created ?? assistant.time.created
  const end = assistant.time.completed ?? assistant.time.created
  return end > start ? end - start : 0
}

export function finalOutputTps(messages: UsageMessage[], messageSamples: Record<string, StreamSample[]>): number | undefined {
  const { last } = sessionUsageTotals(messages)
  if (!last || last.tokens.output <= 0) return undefined
  const sampleWindow = messageSamples[last.id] ?? []
  const activeMs = activeDurationMs(sampleWindow)
  const wallMs = assistantWallMs(messages, last)
  const durationMs = activeMs > 0 ? activeMs : wallMs
  return exactTpsValue(last.tokens.output, durationMs)
}

export function formatTps(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  if (value >= 100) return `${Math.round(value)} TPS`
  if (value >= 10) return `${value.toFixed(1)} TPS`
  return `${value.toFixed(2)} TPS`
}

export function formatTokenCount(value: number): string | undefined {
  if (!(value > 0) || !Number.isFinite(value)) return undefined
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`
  return new Intl.NumberFormat("en-US").format(Math.round(value))
}

export type UsageLineInput = {
  busy: boolean
  liveTps?: number
  finalTps?: number
  tokens?: number
}

/** Footer line: `~42 TPS · 12,345 tokens` (live) or `38 TPS · 12,345 tokens` (final). */
export function formatUsageLine(input: UsageLineInput): string | undefined {
  const tps =
    input.busy && input.liveTps !== undefined
      ? formatTps(input.liveTps)
        ? `~${formatTps(input.liveTps)}`
        : undefined
      : formatTps(input.finalTps)
  const tokenCount = formatTokenCount(input.tokens ?? 0)
  const parts = [tps, tokenCount ? `${tokenCount} tokens` : undefined].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : undefined
}
