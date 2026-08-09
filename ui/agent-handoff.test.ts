import { afterEach, describe, expect, test } from "bun:test"
import { requestAgentHandoff, resetAgentHandoffForTests, subscribeAgentHandoff } from "./agent-handoff"

afterEach(() => resetAgentHandoffForTests())

describe("Agent handoff delivery", () => {
  test("queues an unhandled request for the next consumer exactly once", () => {
    const observed: string[] = []
    const consumed: string[] = []
    subscribeAgentHandoff((request) => {
      observed.push(request.text)
      return undefined
    })

    requestAgentHandoff({ text: "Inspect this", source: "files" })
    expect(observed).toEqual(["Inspect this"])

    subscribeAgentHandoff(
      (request) => {
        consumed.push(request.text)
        return true
      },
      { consumer: true },
    )
    subscribeAgentHandoff(
      () => {
        consumed.push("replayed twice")
        return true
      },
      { consumer: true },
    )
    expect(consumed).toEqual(["Inspect this"])
  })

  test("uses clipboard only when no active consumer handles the request", async () => {
    const writes: string[] = []
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator")
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: async (value: string) => void writes.push(value) } },
    })
    try {
      const unsubscribe = subscribeAgentHandoff(() => true, { consumer: true })
      requestAgentHandoff({ text: "Handled", copyFallback: true })
      await Promise.resolve()
      expect(writes).toEqual([])

      unsubscribe()
      requestAgentHandoff({ text: "Fallback", copyFallback: true })
      await Promise.resolve()
      expect(writes).toEqual(["Fallback"])
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor)
      else Reflect.deleteProperty(globalThis, "navigator")
    }
  })
})
