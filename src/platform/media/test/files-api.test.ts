import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createFilesApi, parseRange } from "../files-api"

const root = path.join(import.meta.dir, ".tmp-files-api")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("HTTP byte ranges", () => {
  test("distinguishes an absent range from malformed and unsatisfiable ranges", () => {
    expect(parseRange(undefined, 10)).toBeUndefined()
    for (const header of ["items=0-1", "bytes=", "bytes=1.5-2", "bytes=1e1-", "bytes=0-1,2-3", "bytes=-0", "bytes=8-7"]) {
      expect(parseRange(header, 10)).toBeNull()
    }
    expect(parseRange("bytes=10-", 10)).toBeNull()
    expect(parseRange("bytes=0-0", 0)).toBeNull()
  })

  test("preserves suffix, open, and closed integer ranges", () => {
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 })
    expect(parseRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 })
    expect(parseRange("bytes=2-20", 10)).toEqual({ start: 2, end: 9 })
  })

  test("returns 416 with the file size for malformed and unsatisfiable requests", async () => {
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "data.bin"), "0123456789")
    await writeFile(path.join(root, "empty.bin"), "")
    const app = await createFilesApi(root)

    for (const [file, range, size] of [
      ["data.bin", "bytes=1.5-2", 10],
      ["data.bin", "bytes=20-", 10],
      ["data.bin", "bytes=0-1,2-3", 10],
      ["empty.bin", "bytes=0-0", 0],
    ] as const) {
      const response = await app.request(`/raw?path=${file}`, { headers: { Range: range } })
      expect(response.status).toBe(416)
      expect(response.headers.get("content-range")).toBe(`bytes */${size}`)
    }
  })

  test("serves a valid range and a full response only when Range is absent", async () => {
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "data.bin"), "0123456789")
    const app = await createFilesApi(root)

    const partial = await app.request("/raw?path=data.bin", { headers: { Range: "bytes=-3" } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get("content-range")).toBe("bytes 7-9/10")
    expect(await partial.text()).toBe("789")

    const full = await app.request("/raw?path=data.bin")
    expect(full.status).toBe(200)
    expect(await full.text()).toBe("0123456789")
  })
})
