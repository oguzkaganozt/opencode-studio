import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { initializeStudio } from "../library"
import { type DesignEvent, ensureDesignWatching, onDesignEvent } from "../watcher"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe("cad design watcher", () => {
  test("emits design-changed after manifest write", async () => {
    const tmpRoot = await mkdtemp(path.join(tmpdir(), "cad-watch-"))
    roots.push(tmpRoot)
    const layout = await initializeStudio(tmpRoot)
    await mkdir(path.join(layout.designsRoot, "demo"), { recursive: true })

    const events: DesignEvent[] = []
    const unsubscribe = onDesignEvent((event) => events.push(event))
    ensureDesignWatching(layout)

    await writeFile(path.join(layout.designsRoot, "demo", "manifest.json"), "{}")
    await Bun.sleep(700)
    unsubscribe()

    expect(events.some((e) => e.type === "designs-changed")).toBe(true)
    expect(events.some((e) => e.type === "design-changed" && e.designId === "demo")).toBe(true)
  })
})
