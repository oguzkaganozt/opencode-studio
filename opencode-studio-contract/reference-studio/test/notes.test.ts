import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readNote, writeNote } from "../src/notes"

describe("note file confinement", () => {
  test("rejects symlink reads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-note-read-"))
    const dataRoot = path.join(root, "data")
    const outside = path.join(root, "outside.json")
    await mkdir(dataRoot)
    await writeFile(outside, JSON.stringify({ id: "escape", title: "Secret", body: "outside" }))
    await symlink(outside, path.join(dataRoot, "escape.note.json"))

    await expect(readNote(dataRoot, "escape")).rejects.toThrow()
  })

  test("replaces a symlink without writing through it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-note-write-"))
    const dataRoot = path.join(root, "data")
    const outside = path.join(root, "outside.txt")
    const notePath = path.join(dataRoot, "escape.note.json")
    await mkdir(dataRoot)
    await writeFile(outside, "unchanged")
    await symlink(outside, notePath)

    await writeNote(dataRoot, { id: "escape", title: "Safe", body: "inside" })

    expect(await readFile(outside, "utf8")).toBe("unchanged")
    expect((await lstat(notePath)).isFile()).toBe(true)
    expect((await readNote(dataRoot, "escape")).body).toBe("inside")
  })
})
