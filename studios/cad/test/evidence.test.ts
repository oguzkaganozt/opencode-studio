import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { currentEvidence, type EvidenceV1, latestByKey, listEvidenceRecords, writeEvidenceRecord } from "../host/evidence"

const base = (over: Partial<EvidenceV1> = {}): Omit<EvidenceV1, "schema" | "recordedAt"> => ({
  id: "req-body-x",
  axis: "requirement",
  buildRevision: "rev1",
  contractHash: "c1",
  subjects: ["body"],
  requirementId: "body-x",
  status: "pass",
  findings: [],
  ...over,
})

describe("disk evidence records", () => {
  test("writes and lists records", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cad-ev-"))
    await writeEvidenceRecord(dir, base())
    const records = await listEvidenceRecords(dir)
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe("pass")
    expect(records[0]?.recordedAt).toBeGreaterThan(0)
  })

  test("currentEvidence filters by buildRevision and contractHash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cad-ev-"))
    await writeEvidenceRecord(dir, base({ id: "req-a", buildRevision: "rev1", contractHash: "c1" }))
    await writeEvidenceRecord(dir, base({ id: "req-b", buildRevision: "rev2", contractHash: "c1" }))
    await writeEvidenceRecord(dir, base({ id: "req-c", buildRevision: "rev1", contractHash: "c2" }))
    const current = await currentEvidence(dir, "rev1", "c1")
    expect(current.map((record) => record.id)).toEqual(["req-a"])
  })

  test("overwriting the same id keeps only the latest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cad-ev-"))
    await writeEvidenceRecord(dir, base({ status: "pass" }))
    await new Promise((resolve) => setTimeout(resolve, 2))
    await writeEvidenceRecord(dir, base({ status: "fail" }))
    const latest = await currentEvidence(dir, "rev1", "c1")
    expect(latest).toHaveLength(1)
    expect(latest[0]?.status).toBe("fail")
  })

  test("malformed records are ignored", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cad-ev-"))
    await writeEvidenceRecord(dir, base())
    await mkdir(path.join(dir, "evidence", "records"), { recursive: true })
    await writeFile(path.join(dir, "evidence", "records", "forged.json"), '{"schema":1,"id":"forged","status":"pass"}')
    const records = await listEvidenceRecords(dir)
    expect(records).toHaveLength(1)
    expect(records[0]?.id).toBe("req-body-x")
  })

  test("latestByKey dedupes to the newest per key", async () => {
    const older: EvidenceV1 = { schema: 1, ...base({ status: "fail" }), recordedAt: 100 }
    const newer: EvidenceV1 = { schema: 1, ...base({ status: "pass" }), recordedAt: 200 }
    const other: EvidenceV1 = {
      schema: 1,
      ...base({ id: "fit-x", axis: "interface", interfaceId: "x", requirementId: undefined }),
      recordedAt: 150,
    }
    const latest = latestByKey([older, other, newer], (record) => record.requirementId ?? record.interfaceId ?? record.id)
    expect(latest).toHaveLength(2)
    expect(latest.find((record) => record.id === "req-body-x")?.status).toBe("pass")
  })
})
