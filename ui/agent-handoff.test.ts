import { describe, expect, test } from "bun:test"
import { __resetAgentHandoffForTests, type AgentHandoffRequest, requestAgentHandoff, subscribeAgentHandoff } from "./agent-handoff"

describe("requestAgentHandoff", () => {
  test("delivers normalized request to subscribers", () => {
    __resetAgentHandoffForTests()
    const seen: unknown[] = []
    const unsub = subscribeAgentHandoff((req) => seen.push(req))
    requestAgentHandoff({ text: "  hello  ", source: "cad" })
    expect(seen).toEqual([
      {
        text: "hello",
        source: "cad",
        open: true,
        copyFallback: false,
      },
    ])
    unsub()
  })

  test("ignores empty text", () => {
    __resetAgentHandoffForTests()
    let calls = 0
    subscribeAgentHandoff(() => {
      calls += 1
    })
    requestAgentHandoff({ text: "   " })
    expect(calls).toBe(0)
  })

  test("respects open false", () => {
    __resetAgentHandoffForTests()
    let last: AgentHandoffRequest | undefined
    subscribeAgentHandoff((req) => {
      last = req
    })
    requestAgentHandoff({ text: "x", open: false })
    expect(last).toEqual({ text: "x", open: false, copyFallback: false })
  })

  test("open false still delivers to subscribers (consumers decide)", () => {
    __resetAgentHandoffForTests()
    let calls = 0
    subscribeAgentHandoff((req) => {
      if (req.open === false) calls += 1
    })
    requestAgentHandoff({ text: "stay closed", open: false })
    expect(calls).toBe(1)
  })
})
