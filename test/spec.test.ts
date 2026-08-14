import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { hashSourceFiles, type StudioSpec, specFilePath, withFreshness, writeSpec } from "../src/core/spec"

function spec(overrides: Partial<StudioSpec> = {}): StudioSpec {
  return {
    schema: 1,
    studio: "fw",
    id: "blink",
    name: "blink",
    status: "published",
    sourceHash: "abc",
    updatedAt: "2026-01-01T00:00:00.000Z",
    summary: "hello",
    facts: {},
    ...overrides,
  }
}

describe("studio spec", () => {
  test("writeSpec then hash mismatch becomes stale", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-spec-"))
    const source = path.join(root, "main.c")
    await writeFile(source, "v1\n")
    const hash = await hashSourceFiles([source])
    await writeSpec(root, spec({ sourceHash: hash }))
    expect(await Bun.file(specFilePath(root)).exists()).toBe(true)
    await writeFile(source, "v2\n")
    const next = await hashSourceFiles([source])
    expect(withFreshness(spec({ sourceHash: hash }), next).status).toBe("stale")
    expect(withFreshness(spec({ status: "blocked", sourceHash: hash }), next).status).toBe("blocked")
  })
})
