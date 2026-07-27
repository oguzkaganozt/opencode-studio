import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createFilesApi, parseRange, resolveInside, resolveWorkspaceRoot } from "../files-api"

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "osc-files-"))
  temps.push(root)
  return root
}

describe("files-api helpers", () => {
  test("resolveInside rejects escape and symlinks", async () => {
    const root = await resolveWorkspaceRoot(await workspace())
    await writeFile(path.join(root, "ok.txt"), "hi")
    await expect(resolveInside(root, "../outside")).rejects.toThrow(/escapes/)
    await expect(resolveInside(root, "missing")).rejects.toThrow(/Not found/)
    const link = path.join(root, "link.txt")
    await symlink(path.join(root, "ok.txt"), link)
    await expect(resolveInside(root, "link.txt")).rejects.toThrow(/Symlinks/)
    const inside = await resolveInside(root, "ok.txt")
    expect(inside.relative).toBe("ok.txt")
  })

  test("parseRange handles suffix and open end", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 })
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange("bytes=200-300", 100)).toBeNull()
  })
})

describe("createFilesApi", () => {
  test("lists workspace, hides dotfiles, streams raw", async () => {
    const root = await workspace()
    await mkdir(path.join(root, "media"), { recursive: true })
    await writeFile(path.join(root, "media", "a.txt"), "hello")
    await writeFile(path.join(root, ".env"), "SECRET=1")
    await writeFile(path.join(root, ".hidden"), "x")
    const app = await createFilesApi(root)

    const tree = await app.request("http://local/tree")
    expect(tree.status).toBe(200)
    const body = (await tree.json()) as { entries: Array<{ name: string }> }
    expect(body.entries.map((e) => e.name).sort()).toEqual(["media"])
    expect(body.entries.some((e) => e.name === ".env")).toBe(false)

    const nested = await app.request("http://local/tree?path=media")
    const nestedBody = (await nested.json()) as { entries: Array<{ name: string; preview: string }> }
    expect(nestedBody.entries.some((e) => e.name === "a.txt" && e.preview === "text")).toBe(true)

    const content = await app.request("http://local/content?path=media/a.txt")
    expect(content.status).toBe(200)
    expect((await content.json()).text).toBe("hello")

    const raw = await app.request("http://local/raw?path=media/a.txt")
    expect(raw.status).toBe(200)
    expect(await raw.text()).toBe("hello")

    const denied = await app.request("http://local/raw?path=../etc/passwd")
    expect(denied.status).toBe(400)
  })

  test("range request returns 206", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "bin.dat"), "0123456789")
    const app = await createFilesApi(root)
    const res = await app.request("http://local/raw?path=bin.dat", { headers: { range: "bytes=2-5" } })
    expect(res.status).toBe(206)
    expect(await res.text()).toBe("2345")
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10")
  })
})
