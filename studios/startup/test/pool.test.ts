import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { listCandidates, loadPool, rejectCandidate, upsertCandidate } from "../pool"
import { normalizePoolEntry } from "../schemas"

function sample(over: Record<string, unknown> = {}) {
  return {
    name: "test-candidate",
    problem: "A recurring ops pain with public complaints.",
    buyer: "SMB ops team",
    shelf: "GitHub Marketplace",
    signal_class: "B",
    evidence: [{ url: "https://example.com/thread", summary: "Public complaint thread." }],
    verdict: "partial",
    total: 6,
    rubric: { pain: 2, payment: 1, shelf: 1, freshness: 1, fit: 1 },
    one_liner: "Stop doing X by hand every week.",
    status: "pool",
    batch: "test",
    first_seen: "2026-07-23",
    ...over,
  }
}

describe("schemas", () => {
  test("normalizes a valid pool entry", () => {
    const entry = normalizePoolEntry(sample())
    expect(entry.name).toBe("test-candidate")
    expect(entry.total).toBe(6)
  })

  test("rejects bad names", () => {
    expect(() => normalizePoolEntry(sample({ name: "Not Valid" }))).toThrow(/Invalid candidate name/)
  })

  test("requires evidence", () => {
    expect(() => normalizePoolEntry(sample({ evidence: [] }))).toThrow(/evidence/)
  })
})

describe("pool store", () => {
  test("upsert list reject roundtrip", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "startup-pool-"))
    const entry = await upsertCandidate(dataRoot, sample())
    expect(entry.name).toBe("test-candidate")

    await upsertCandidate(
      dataRoot,
      sample({
        name: "second-idea",
        total: 9,
        one_liner: "Higher score idea",
      }),
    )

    const listed = await listCandidates(dataRoot)
    expect(listed.map((c) => c.name)).toEqual(["second-idea", "test-candidate"])

    const rejected = await rejectCandidate(dataRoot, "test-candidate", "duplicate territory")
    expect(rejected.rejected.reason).toBe("duplicate territory")
    expect(rejected.remaining).toBe(1)

    const pool = await loadPool(dataRoot)
    expect(pool).toHaveLength(1)
    expect(pool[0]?.name).toBe("second-idea")
  })
})
