import { describe, expect, test } from "bun:test"
import {
  activeDurationMs,
  appendMessageSample,
  appendStreamSample,
  estimateStreamTokens,
  exactTpsValue,
  finalOutputTps,
  formatTokenCount,
  formatTps,
  formatUsageLine,
  liveTpsValue,
  pruneStreamSamples,
  type StreamSample,
  sessionUsageTotals,
  tokenTotal,
  truncateTrackedMessages,
  type UsageMessage,
} from "./session-usage"

describe("estimateStreamTokens", () => {
  test("ceil-ish via round of chars/4", () => {
    expect(estimateStreamTokens(0)).toBe(0)
    expect(estimateStreamTokens(4)).toBe(1)
    expect(estimateStreamTokens(5)).toBe(1)
    expect(estimateStreamTokens(8)).toBe(2)
  })
})

describe("tokenTotal", () => {
  test("sums all buckets", () => {
    expect(
      tokenTotal({
        input: 100,
        output: 50,
        reasoning: 20,
        cache: { read: 10, write: 5 },
      }),
    ).toBe(185)
  })
})

describe("activeDurationMs", () => {
  test("single sample uses bounded default", () => {
    expect(activeDurationMs([{ at: 1_000, tokens: 4 }])).toBe(1_000)
  })

  test("caps gaps between samples", () => {
    const samples: StreamSample[] = [
      { at: 0, tokens: 1 },
      { at: 5_000, tokens: 1 },
      { at: 5_200, tokens: 1 },
    ]
    // min(5000, 1250) + min(200, 1250) = 1450, floored to max(…, 1000)
    expect(activeDurationMs(samples)).toBe(1_450)
  })
})

describe("stream sample windows", () => {
  test("prune drops samples older than window", () => {
    const now = 20_000
    const kept = pruneStreamSamples(
      [
        { at: 1_000, tokens: 1 },
        { at: 10_000, tokens: 2 },
        { at: 19_000, tokens: 3 },
      ],
      now,
    )
    expect(kept.map((s) => s.tokens)).toEqual([2, 3])
  })

  test("append keeps rolling window", () => {
    const next = appendStreamSample([{ at: 0, tokens: 1 }], { at: 20_000, tokens: 9 })
    expect(next).toEqual([{ at: 20_000, tokens: 9 }])
  })

  test("truncateTrackedMessages keeps newest message ids", () => {
    const stats: Record<string, StreamSample[]> = {}
    for (let i = 0; i < 30; i++) stats[`m${i}`] = [{ at: i * 100, tokens: 1 }]
    const trimmed = truncateTrackedMessages(stats)
    expect(Object.keys(trimmed).length).toBe(24)
    expect(trimmed.m29).toBeDefined()
    expect(trimmed.m0).toBeUndefined()
  })

  test("appendMessageSample slices per message", () => {
    let stats: Record<string, StreamSample[]> = {}
    stats = appendMessageSample(stats, "a", { at: 1, tokens: 1 })
    stats = appendMessageSample(stats, "a", { at: 2, tokens: 2 })
    expect(stats.a).toHaveLength(2)
  })
})

describe("liveTpsValue", () => {
  test("returns undefined when stale", () => {
    const now = 10_000
    expect(liveTpsValue([{ at: now - 2_000, tokens: 40 }], now)).toBeUndefined()
  })

  test("computes rolling tps", () => {
    const now = 10_000
    const samples: StreamSample[] = [
      { at: now - 1_000, tokens: 40 },
      { at: now - 200, tokens: 40 },
    ]
    const tps = liveTpsValue(samples, now)
    expect(tps).toBeGreaterThan(0)
    expect(tps).toBeLessThan(200)
  })
})

describe("exact / final tps", () => {
  test("exactTpsValue divides tokens by seconds", () => {
    expect(exactTpsValue(100, 2_000)).toBe(50)
    expect(exactTpsValue(0, 2_000)).toBeUndefined()
  })

  test("finalOutputTps uses wall clock when no samples", () => {
    const messages: UsageMessage[] = [
      { role: "user", id: "u1", time: { created: 1_000 } },
      {
        role: "assistant",
        id: "a1",
        parentID: "u1",
        cost: 0.01,
        tokens: { input: 10, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1_100, completed: 3_100 },
      },
    ]
    // wall: user.created 1000 → completed 3100 = 2100ms → 100 / 2.1
    expect(finalOutputTps(messages, {})).toBeCloseTo(100 / 2.1)
  })

  test("finalOutputTps prefers active sample duration", () => {
    const messages: UsageMessage[] = [
      { role: "user", id: "u1", time: { created: 0 } },
      {
        role: "assistant",
        id: "a1",
        parentID: "u1",
        tokens: { input: 0, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 0, completed: 60_000 },
      },
    ]
    const samples = {
      a1: [
        { at: 0, tokens: 10 },
        { at: 1_000, tokens: 10 },
      ],
    }
    // active duration max(1000, 1000) = 1000ms → 100 tokens/s
    expect(finalOutputTps(messages, samples)).toBe(100)
  })
})

describe("sessionUsageTotals", () => {
  test("sums assistant tokens and cost across the session", () => {
    const messages: UsageMessage[] = [
      { role: "user", id: "u1", time: { created: 1 } },
      {
        role: "assistant",
        id: "a1",
        cost: 0.02,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2, completed: 3 },
      },
      {
        role: "assistant",
        id: "a2",
        cost: 0.03,
        tokens: { input: 200, output: 80, reasoning: 20, cache: { read: 5, write: 5 } },
        time: { created: 4, completed: 5 },
      },
    ]
    const totals = sessionUsageTotals(messages)
    expect(totals.tokens).toBe(150 + 310)
    expect(totals.cost).toBeCloseTo(0.05)
    expect(totals.last?.id).toBe("a2")
  })
})

describe("formatters", () => {
  test("formatTps precision bands", () => {
    expect(formatTps(0)).toBeUndefined()
    expect(formatTps(3.14)).toBe("3.14 TPS")
    expect(formatTps(12.34)).toBe("12.3 TPS")
    expect(formatTps(150.4)).toBe("150 TPS")
  })

  test("formatTokenCount compact", () => {
    expect(formatTokenCount(0)).toBeUndefined()
    expect(formatTokenCount(999)).toBe("999")
    expect(formatTokenCount(12_500)).toBe("12.5k")
    expect(formatTokenCount(1_200_000)).toBe("1.2M")
  })

  test("formatUsageLine live vs final", () => {
    expect(
      formatUsageLine({
        busy: true,
        liveTps: 42.5,
        finalTps: 30,
        tokens: 12_000,
      }),
    ).toBe("~42.5 TPS · 12.0k tokens")

    expect(
      formatUsageLine({
        busy: false,
        liveTps: 42.5,
        finalTps: 30,
        tokens: 500,
      }),
    ).toBe("30.0 TPS · 500 tokens")
  })
})
