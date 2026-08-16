import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createFwApi } from "../api"
import { scaffoldFwProject } from "../scaffold"
import { closeAllFwWatchers, ensureFwWatching, type FwProjectEvent, onFwProjectEvent } from "../watcher"

const temps: string[] = []

afterEach(async () => {
  closeAllFwWatchers()
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function waitForEvent(match: (event: FwProjectEvent) => boolean, timeoutMs = 2000) {
  return new Promise<FwProjectEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error("timed out waiting for fw watcher event"))
    }, timeoutMs)
    const off = onFwProjectEvent((event) => {
      if (!match(event)) return
      clearTimeout(timer)
      off()
      resolve(event)
    })
  })
}

describe("fw watcher", () => {
  test("emits artifacts-changed when sim/last.json is written", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-watch-"))
    temps.push(root)
    const created = await scaffoldFwProject(root, "node", "esp32")
    await ensureFwWatching(root)
    const pending = waitForEvent((event) => event.type === "artifacts-changed" && event.projectId === "node")
    await mkdir(path.join(created.directory, "sim"), { recursive: true })
    await writeFile(path.join(created.directory, "sim", "last.json"), "{}\n")
    expect(await pending).toMatchObject({ type: "artifacts-changed", projectId: "node" })
  })

  test("emits projects-changed when a project is created after watching starts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-list-"))
    temps.push(root)
    await ensureFwWatching(root)
    const pending = waitForEvent((event) => event.type === "projects-changed")
    await scaffoldFwProject(root, "node", "esp32")
    expect(await pending).toMatchObject({ type: "projects-changed" })
  })

  test("watches sim/ after a project id is deleted and recreated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-re-"))
    temps.push(root)
    const first = await scaffoldFwProject(root, "node", "esp32")
    await ensureFwWatching(root)
    await rm(first.directory, { recursive: true, force: true })
    await ensureFwWatching(root)
    const created = await scaffoldFwProject(root, "node", "esp32")
    await mkdir(path.join(created.directory, "sim"), { recursive: true })
    await ensureFwWatching(root)
    const pending = waitForEvent((event) => event.type === "artifacts-changed" && event.projectId === "node", 4000)
    await writeFile(path.join(created.directory, "sim", "last.json"), "{}\n")
    expect(await pending).toMatchObject({ type: "artifacts-changed", projectId: "node" })
  })

  test("GET /events sends a connected frame", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-sse-"))
    temps.push(root)
    await scaffoldFwProject(root, "node", "esp32")
    const controller = new AbortController()
    const response = await createFwApi(root).request("/events", { signal: controller.signal })
    expect(response.headers.get("Content-Type")).toContain("text/event-stream")
    const reader = response.body?.getReader()
    expect(reader).toBeTruthy()
    const first = await reader!.read()
    expect(new TextDecoder().decode(first.value)).toContain("connected")
    controller.abort()
  })
})
