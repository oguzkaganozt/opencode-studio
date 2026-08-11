import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { StudioError } from "../src/core/errors"
import { atomicWriteJson, isInside, readRegularFileAt, resolveContainedPath, resolveUnderRoot } from "../src/core/paths"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempRoot(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  temps.push(root)
  return root
}

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

describe("resolveUnderRoot", () => {
  test("resolves relative and absolute inside root", () => {
    expect(resolveUnderRoot("/ws", "a/b")).toBe(path.resolve("/ws", "a/b"))
    expect(resolveUnderRoot("/ws", "/ws/a")).toBe(path.resolve("/ws/a"))
  })
  test("rejects escape", () => {
    expect(() => resolveUnderRoot("/ws", "../etc")).toThrow(StudioError)
    expect(() => resolveUnderRoot("/ws", "/other")).toThrow(/escapes root/)
  })
  test("root itself is inside (isInside equality)", () => {
    expect(resolveUnderRoot("/ws", "/ws")).toBe(path.resolve("/ws"))
    expect(resolveUnderRoot("/ws", ".", { allowRoot: true })).toBe(path.resolve("/ws"))
  })
})

describe("resolveContainedPath", () => {
  test("resolves regular file and relative path", async () => {
    const root = await tempRoot("osc-paths-")
    await mkdir(path.join(root, "sub"))
    await writeFile(path.join(root, "sub", "file.txt"), "hi")
    const result = await resolveContainedPath(root, path.join(root, "sub", "file.txt"), { kind: "file" })
    expect(result.absolute).toBe(await realpath(path.join(root, "sub", "file.txt")))
    expect(result.relative).toBe("sub/file.txt")
    expect(result.info.isFile()).toBe(true)
  })

  test("allowRoot accepts the root directory", async () => {
    const root = await tempRoot("osc-paths-")
    const result = await resolveContainedPath(root, root, { allowRoot: true, kind: "directory" })
    expect(result.absolute).toBe(await realpath(root))
    expect(result.relative).toBe("")
  })

  test("rejects file symlink when rejectSymlink default", async () => {
    const root = await tempRoot("osc-paths-")
    const outside = await tempRoot("osc-outside-")
    await writeFile(path.join(outside, "secret.txt"), "secret")
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"))
    await expect(resolveContainedPath(root, path.join(root, "link.txt"), { kind: "file" })).rejects.toMatchObject({
      code: "symlink_rejected",
    })
  })

  test("CAD-style rejectSymlink false accepts in-root file symlink", async () => {
    const root = await tempRoot("osc-paths-")
    await writeFile(path.join(root, "real.txt"), "data")
    await symlink(path.join(root, "real.txt"), path.join(root, "alias.txt"))
    const result = await resolveContainedPath(root, path.join(root, "alias.txt"), {
      kind: "file",
      rejectSymlink: false,
      realpathRoot: true,
    })
    expect(result.absolute).toBe(await realpath(path.join(root, "real.txt")))
    expect(result.relative).toBe("real.txt")
  })

  test("CAD-style rejectSymlink false rejects outside symlink target", async () => {
    const root = await tempRoot("osc-paths-")
    const outside = await tempRoot("osc-outside-")
    await writeFile(path.join(outside, "secret.txt"), "secret")
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"))
    await expect(
      resolveContainedPath(root, path.join(root, "link.txt"), {
        kind: "file",
        rejectSymlink: false,
        realpathRoot: true,
      }),
    ).rejects.toMatchObject({ code: "path_resolves_outside" })
  })

  test("rejects parent symlink escape", async () => {
    const root = await tempRoot("osc-paths-")
    const outside = await tempRoot("osc-outside-")
    await mkdir(path.join(outside, "real"))
    await writeFile(path.join(outside, "real", "secret.txt"), "secret")
    await symlink(path.join(outside, "real"), path.join(root, "linkdir"))
    await expect(resolveContainedPath(root, path.join(root, "linkdir", "secret.txt"), { kind: "file" })).rejects.toMatchObject({
      code: "path_resolves_outside",
    })
  })

  test("realpathRoot compares against canonical root", async () => {
    const physical = await tempRoot("osc-paths-phys-")
    await writeFile(path.join(physical, "a.txt"), "x")
    const parent = await tempRoot("osc-paths-parent-")
    const linkRoot = path.join(parent, "link-root")
    await symlink(physical, linkRoot)
    const viaLink = await resolveContainedPath(linkRoot, path.join(linkRoot, "a.txt"), {
      kind: "file",
      realpathRoot: true,
    })
    expect(viaLink.absolute).toBe(await realpath(path.join(physical, "a.txt")))
    expect(viaLink.relative).toBe("a.txt")
  })

  test("not_found for missing path", async () => {
    const root = await tempRoot("osc-paths-")
    await expect(resolveContainedPath(root, path.join(root, "missing.txt"), { kind: "file" })).rejects.toMatchObject({
      code: "not_found",
    })
  })
})

describe("readRegularFileAt", () => {
  test("reads regular file inside root", async () => {
    const root = await tempRoot("osc-paths-")
    await writeFile(path.join(root, "file.txt"), "hello")
    const buffer = await readRegularFileAt(root, path.join(root, "file.txt"))
    expect(buffer.toString("utf8")).toBe("hello")
  })
  test("rejects path escape", async () => {
    const root = await tempRoot("osc-paths-")
    const outside = await tempRoot("osc-outside-")
    await writeFile(path.join(outside, "secret.txt"), "secret")
    expect(readRegularFileAt(root, path.join(outside, "secret.txt"))).rejects.toThrow(/escapes root/)
  })
  test("rejects symlink file", async () => {
    const root = await tempRoot("osc-paths-")
    const outside = await tempRoot("osc-outside-")
    await writeFile(path.join(outside, "secret.txt"), "secret")
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"))
    expect(readRegularFileAt(root, path.join(root, "link.txt"))).rejects.toThrow()
  })
  test("rejects symlink parent", async () => {
    const root = await tempRoot("osc-paths-")
    const outside = await tempRoot("osc-outside-")
    await mkdir(path.join(outside, "real"))
    await writeFile(path.join(outside, "real", "secret.txt"), "secret")
    await symlink(path.join(outside, "real"), path.join(root, "linkdir"))
    expect(readRegularFileAt(root, path.join(root, "linkdir", "secret.txt"))).rejects.toThrow()
  })
  test("rejects directory", async () => {
    const root = await tempRoot("osc-paths-")
    await mkdir(path.join(root, "subdir"))
    expect(readRegularFileAt(root, path.join(root, "subdir"))).rejects.toThrow()
  })
})

describe("atomicWriteJson", () => {
  test("writes and reads back", async () => {
    const root = await tempRoot("osc-paths-")
    const target = path.join(root, "data.json")
    await atomicWriteJson(target, { name: "test", values: [1, 2, 3] })
    const text = await Bun.file(target).text()
    expect(JSON.parse(text)).toEqual({ name: "test", values: [1, 2, 3] })
  })
  test("rejects escape when root set", async () => {
    const root = await tempRoot("osc-paths-")
    const outside = await tempRoot("osc-outside-")
    expect(atomicWriteJson(path.join(outside, "data.json"), {}, { root })).rejects.toThrow(/escapes root/)
  })
})
