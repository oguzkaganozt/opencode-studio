import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { canonicalJson, contractHashOf, normalizeAcceptanceContract, readAcceptance, writeAcceptance } from "../host/acceptance"

const validContract = () => ({
  schema: 1 as const,
  state: "locked" as const,
  authority: "harness" as const,
  manufacturing: {
    process: "fdm" as const,
    buildVolumeMm: [220, 220, 250] as [number, number, number],
    nozzleMm: 0.4,
    minimumWallMm: 1.2,
    bedToleranceMm: 0.1,
    defaultClearanceMm: 0.2,
  },
  dimensions: [
    {
      id: "body-x",
      kind: "bbox" as const,
      artifactId: "body",
      measure: "size" as const,
      axis: "X" as const,
      targetMm: 100,
      toleranceMm: 5,
    },
  ],
  interfaces: [{ id: "body-lid", a: "body", b: "lid", fit: "clearance" as const, targetMm: 0.2, toleranceMm: 0.3 }],
})

describe("acceptance contract", () => {
  test("canonical JSON is stable under key reordering", () => {
    const a = canonicalJson({ b: 1, a: { z: 2, y: 3 }, c: [1, 2] })
    const b = canonicalJson({ c: [1, 2], a: { y: 3, z: 2 }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"y":3,"z":2},"b":1,"c":[1,2]}')
  })

  test("contractHash is deterministic and hash-field independent", () => {
    const contract = validContract()
    const first = contractHashOf(contract)
    const second = contractHashOf({ ...contract, manufacturing: { ...contract.manufacturing } })
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  test("normalization rejects unlocked or hash-bearing contracts", () => {
    expect(() => normalizeAcceptanceContract({ ...validContract(), state: "open" })).toThrow(/locked/)
    expect(() => normalizeAcceptanceContract({ ...validContract(), contractHash: "abc" })).toThrow(/contractHash/)
    expect(() =>
      normalizeAcceptanceContract({ ...validContract(), manufacturing: { ...validContract().manufacturing, nozzleMm: -1 } }),
    ).toThrow(/nozzleMm/)
  })

  test("normalization enforces dimension/interface integrity", () => {
    expect(() =>
      normalizeAcceptanceContract({
        ...validContract(),
        dimensions: [
          { ...validContract().dimensions[0]!, id: "body-x" },
          { ...validContract().dimensions[0]!, id: "body-x" },
        ],
      }),
    ).toThrow(/Duplicate dimension/)
    expect(() =>
      normalizeAcceptanceContract({ ...validContract(), dimensions: [{ ...validContract().dimensions[0]!, axis: "W" }] }),
    ).toThrow(/axis/)
    expect(() =>
      normalizeAcceptanceContract({ ...validContract(), interfaces: [{ ...validContract().interfaces[0]!, a: "x", b: "x" }] }),
    ).toThrow(/distinct/)
  })

  test("write + read round-trips the pinned hash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cad-accept-"))
    const written = await writeAcceptance(dir, validContract())
    expect(written.contractHash).toBe(contractHashOf(validContract()))
    const history = JSON.parse(await readFile(path.join(dir, "acceptance", "history", `${written.contractHash}.json`), "utf8"))
    expect(history.contractHash).toBe(written.contractHash)
    expect((await readAcceptance(dir)).contractHash).toBe(written.contractHash)
  })

  test("read rejects a tampered contractHash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cad-accept-"))
    await writeAcceptance(dir, validContract())
    const active = path.join(dir, "acceptance.json")
    const raw = JSON.parse(await readFile(active, "utf8"))
    raw.contractHash = "f".repeat(64)
    await import("node:fs/promises").then((fs) => fs.writeFile(active, JSON.stringify(raw)))
    await expect(readAcceptance(dir)).rejects.toThrow(/does not match/)
  })
})
