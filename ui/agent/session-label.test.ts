import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/client"
import { sessionLabel, sessionOptionLabels } from "./session-label"

const session = (title: string) => ({ id: "session-id", title }) as Session

describe("sessionLabel", () => {
  test("turns generated ISO titles into readable same-day labels", () => {
    const label = sessionLabel(session("New session - 2026-08-09T08:32:31.853Z"), Date.parse("2026-08-09T10:00:00.000Z"))

    expect(label).toStartWith("New session · ")
    expect(label).not.toContain("2026-08-09T")
    expect(label).not.toContain(".853Z")
  })

  test("keeps meaningful session titles unchanged", () => {
    expect(sessionLabel(session("Review the release workflow"))).toBe("Review the release workflow")
  })

  test("disambiguates duplicate generated labels in menu order", () => {
    const rows = [
      { id: "newest", title: "New session - 2026-08-09T08:32:31.853Z" },
      { id: "older", title: "New session - 2026-08-09T08:32:02.000Z" },
      { id: "named", title: "Review the release workflow" },
      { id: "named-again", title: "Review the release workflow" },
    ] as Session[]
    const labels = sessionOptionLabels(rows, Date.parse("2026-08-09T10:00:00.000Z"))

    expect(labels.get("newest")).toMatch(/^New session · .+ \(1\/2\)$/)
    expect(labels.get("older")).toMatch(/^New session · .+ \(2\/2\)$/)
    expect(labels.get("named")).toBe("Review the release workflow")
    expect(labels.get("named-again")).toBe("Review the release workflow")
  })
})
