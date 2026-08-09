import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { sessionGroupsByLastMessage, sessionLabel, sessionOptionLabels } from "./session-label"

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

  test("groups sessions by last message day with the newest activity first", () => {
    const now = new Date(2026, 7, 9, 15).getTime()
    const rows = [
      {
        id: "yesterday",
        title: "Yesterday",
        time: { created: new Date(2026, 7, 8, 8).getTime(), updated: new Date(2026, 7, 8, 22).getTime() },
      },
      {
        id: "today-older",
        title: "Today older",
        time: { created: new Date(2026, 7, 9, 9).getTime(), updated: new Date(2026, 7, 9, 10).getTime() },
      },
      {
        id: "today-newest",
        title: "Today newest",
        time: { created: new Date(2026, 6, 1, 9).getTime(), updated: new Date(2026, 7, 9, 14).getTime() },
      },
    ] as Session[]

    const groups = sessionGroupsByLastMessage(rows, now)

    expect(groups.map((group) => group.sessions.map((row) => row.id))).toEqual([["today-newest", "today-older"], ["yesterday"]])
    expect(groups[0]?.label).toBe(new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(0, "day"))
    expect(groups[1]?.label).toBe(new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-1, "day"))
  })
})
