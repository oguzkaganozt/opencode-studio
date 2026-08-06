import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { atomicWriteJson, isInside, readRegularFileAt } from "../src/core/paths"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("isInside", () => {
  test("inside", () => {
    expect(isInside("/root", "/root/a/b")).toBe(true)
    expect(isInside("/root", "/root")).toBe(true)
  })
  test("parent escape", () => {
    expect(isInside("/root", "/root/../etc")).toBe(false)
    expect(isInside("/root", "/etc")).toBe(false)
  })
  test("prefix collision", () => {
    expect(isInside("/root", "/root-other")).toBe(false)
  })
  test("child to parent", () => {
    expect(isInside("/root/project", "/root")).toBe(false)
  })
})

describe("readRegularFileAt", () => {
  test("reads regular file inside root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-paths-"))
    temps.push(root)
    await writeFile(path.join(root, "file.txt"), "hello")
    const buffer = await readRegularFileAt(root, path.join(root, "file.txt"))
    expect(buffer.toString("utf8")).toBe("hello")
  })
  test("rejects path escape", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-paths-"))
    temps.push(root)
    const outside = await mkdtemp(path.join(tmpdir(), "osc-outside-"))
    temps.push(outside)
    await writeFile(path.join(outside, "secret.txt"), "secret")
    expect(readRegularFileAt(root, path.join(outside, "secret.txt"))).rejects.toThrow(/escapes root/)
  })
  test("rejects symlink file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-paths-"))
    temps.push(root)
    const outside = await mkdtemp(path.join(tmpdir(), "osc-outside-"))
    temps.push(outside)
    await writeFile(path.join(outside, "secret.txt"), "secret")
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"))
    expect(readRegularFileAt(root, path.join(root, "link.txt"))).rejects.toThrow()
  })
  test("rejects symlink parent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-paths-"))
    temps.push(root)
    const outside = await mkdtemp(path.join(tmpdir(), "osc-outside-"))
    temps.push(outside)
    await mkdir(path.join(outside, "real"))
    await writeFile(path.join(outside, "real", "secret.txt"), "secret")
    await symlink(path.join(outside, "real"), path.join(root, "linkdir"))
    expect(readRegularFileAt(root, path.join(root, "linkdir", "secret.txt"))).rejects.toThrow()
  })
  test("rejects directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-paths-"))
    temps.push(root)
    await mkdir(path.join(root, "subdir"))
    expect(readRegularFileAt(root, path.join(root, "subdir"))).rejects.toThrow()
  })
})

describe("atomicWriteJson", () => {
  test("writes and reads back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-paths-"))
    temps.push(root)
    const target = path.join(root, "data.json")
    await atomicWriteJson(target, { name: "test", values: [1, 2, 3] })
    const text = await Bun.file(target).text()
    expect(JSON.parse(text)).toEqual({ name: "test", values: [1, 2, 3] })
  })
  test("rejects escape when root set", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-paths-"))
    temps.push(root)
    const outside = await mkdtemp(path.join(tmpdir(), "osc-outside-"))
    temps.push(outside)
    expect(atomicWriteJson(path.join(outside, "data.json"), {}, { root })).rejects.toThrow(/escapes root/)
  })
})
