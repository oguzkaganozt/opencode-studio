import { describe, expect, test } from "bun:test"
import { assertWorkerWrite, planCadDispatch, takeoverPart } from "../host/dispatch"

describe("cad worker ledger", () => {
  test("plans parallel dispatch only for two or more parts", () => {
    expect(planCadDispatch(["body"]).mode).toBe("serial")
    expect(planCadDispatch(["body", "lid"]).assigned).toEqual(["body", "lid"])
  })

  test("a leased part cannot be written by another session", () => {
    const now = 1_000
    const ledger = takeoverPart({ workers: [] }, "body", "worker-a", now)
    expect(() => assertWorkerWrite({ ledger, partId: "body", sessionId: "worker-b", now: now + 10 })).toThrow(/leased/)
    expect(assertWorkerWrite({ ledger, partId: "body", sessionId: "worker-a", now: now + 10 })?.sessionId).toBe("worker-a")
  })

  test("takeover increments generation and supersedes the prior lease", () => {
    const first = takeoverPart({ workers: [] }, "body", "worker-a", 1_000)
    const second = takeoverPart(first, "body", "worker-b", 2_000)
    const active = second.workers.find((item) => item.state === "starting")
    const old = second.workers.find((item) => item.state === "superseded")
    expect(active?.generation).toBe(2)
    expect(active?.sessionId).toBe("worker-b")
    expect(old?.sessionId).toBe("worker-a")
    expect(() => assertWorkerWrite({ ledger: second, partId: "body", sessionId: "worker-a", now: 2_010 })).toThrow(/leased/)
    expect(assertWorkerWrite({ ledger: second, partId: "body", sessionId: "worker-b", now: 2_010 })?.generation).toBe(2)
  })
})
