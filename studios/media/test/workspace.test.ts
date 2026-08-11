import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { listMediaProjects, resolveMediaProjectDirectory } from "../workspace"

let root: string | undefined

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe("Media workspace", () => {
  test("discovers safe immediate project directories only", async () => {
    root = await mkdtemp(path.join(tmpdir(), "osc-media-"))
    await mkdir(path.join(root, "alpha"))
    await mkdir(path.join(root, "nested", "child"), { recursive: true })
    await mkdir(path.join(root, "Invalid Name"))
    await symlink(path.join(root, "alpha"), path.join(root, "linked"))

    expect((await listMediaProjects(root)).map((project) => project.id)).toEqual(["alpha", "nested"])
    await expect(resolveMediaProjectDirectory(root, path.join(root, "nested", "child"))).rejects.toThrow(/directly under/)
  })
})
