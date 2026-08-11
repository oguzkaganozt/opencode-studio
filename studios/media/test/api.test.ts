import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createMediaApi } from "../api"

let root: string | undefined

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe("Media API", () => {
  test("lists projects and delegates project-scoped file browsing", async () => {
    root = await mkdtemp(path.join(tmpdir(), "osc-media-api-"))
    const project = path.join(root, "demo")
    await mkdir(path.join(project, "media"), { recursive: true })
    await writeFile(path.join(project, "notes.txt"), "hello")
    const app = createMediaApi(root)

    const projects = await app.request("/projects")
    expect(projects.status).toBe(200)
    expect(await projects.json()).toMatchObject({ projects: [{ id: "demo", directory: project }] })

    const tree = await app.request("/projects/demo/files/tree")
    expect(tree.status).toBe(200)
    expect((await tree.json()).entries.map((entry: { name: string }) => entry.name)).toEqual(["media", "notes.txt"])
  })
})
