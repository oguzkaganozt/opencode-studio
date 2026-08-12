import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { GlobalSession } from "@opencode-ai/sdk/v2/client"
import { studioSessionMetadata } from "../src/core/session-history"
import { studioSessionHistory } from "../src/session-history"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function session(input: {
  id: string
  directory: string
  updated: number
  metadata?: Record<string, unknown>
  title?: string
}): GlobalSession {
  return {
    id: input.id,
    title: input.title ?? input.id,
    directory: input.directory,
    metadata: input.metadata,
    time: { created: input.updated - 1, updated: input.updated },
  } as GlobalSession
}

async function roots() {
  const home = await mkdtemp(path.join(os.tmpdir(), "osc-history-"))
  temporary.push(home)
  const cad = path.join(home, "studio", "designs")
  const pcb = path.join(home, "studio", "circuits")
  const media = path.join(home, "studio", "media")
  const fw = path.join(home, "studio", "firmware")
  await mkdir(path.join(cad, "box"), { recursive: true })
  await writeFile(path.join(cad, "box", "design.json"), "{}")
  await mkdir(path.join(pcb, "boards", "demo", "src"), { recursive: true })
  await writeFile(path.join(pcb, "boards", "demo", "src", "circuit.tsx"), "export {}")
  await mkdir(path.join(media, "demo"), { recursive: true })
  await mkdir(path.join(fw, "blink"), { recursive: true })
  await writeFile(path.join(fw, "blink", "project.json"), '{"id":"blink","name":"blink","chip":"esp32c6"}')
  return { home, cad, pcb, media, fw, studios: { cad, pcb, media, fw } }
}

describe("studioSessionHistory", () => {
  test("caps OpenCode history fetch at the default limit", async () => {
    const studioRoots = await roots()
    const rows = Array.from({ length: 550 }, (_, index) =>
      session({ id: `home-${index}`, directory: studioRoots.home, updated: 10_000 - index }),
    )
    let requestedLimit = 0
    const source = async ({ limit }: { limit: number }) => {
      requestedLimit = limit
      return rows.slice(0, limit)
    }

    const result = await studioSessionHistory({ source, roots: studioRoots, scope: "studio" })

    expect(requestedLimit).toBe(500)
    expect(result.sessions).toHaveLength(500)
    expect(result.sessions.at(-1)?.id).toBe("home-499")
  })

  test("keeps root-level PCB projects distinct from the PCB workspace", async () => {
    const studioRoots = await roots()
    const projectMetadata = studioSessionMetadata({
      key: "pcb:Lg",
      kind: "pcb-project",
      studioId: "pcb",
      projectId: "Lg",
      relativePath: ".",
      label: "PCB · Root board",
    })
    const rows = [
      session({ id: "workspace", directory: studioRoots.pcb, updated: 200 }),
      session({ id: "project", directory: studioRoots.pcb, updated: 100, metadata: projectMetadata }),
    ]

    const result = await studioSessionHistory({
      source: async () => rows,
      roots: studioRoots,
      scope: "directory",
      directory: studioRoots.pcb,
      contextKey: "pcb:Lg",
    })

    expect(result.sessions.map((item) => item.id)).toEqual(["project"])
    expect(result.sessions[0]?.context).toMatchObject({ kind: "pcb-project", relativePath: ".", status: "missing" })
  })

  test("returns only Studio contexts with newest activity first", async () => {
    const studioRoots = await roots()
    const rows = [
      session({ id: "unrelated", directory: path.join(os.tmpdir(), "unrelated"), updated: 500 }),
      session({ id: "home", directory: studioRoots.home, updated: 400 }),
      session({ id: "cad", directory: path.join(studioRoots.cad, "box"), updated: 300 }),
      session({ id: "pcb-missing", directory: path.join(studioRoots.pcb, "deleted"), updated: 200 }),
    ]

    const result = await studioSessionHistory({ source: async () => rows, roots: studioRoots, scope: "studio" })

    expect(result.sessions.map((item) => item.id)).toEqual(["home", "cad", "pcb-missing"])
    expect(result.sessions[0]?.context).toMatchObject({ key: "home", status: "available" })
    expect(result.sessions[1]?.context).toMatchObject({ kind: "cad-project", relativePath: "box", status: "available" })
    expect(result.sessions[2]?.context).toMatchObject({ kind: "pcb-project", status: "missing" })
  })

  test("maps metadata-backed sessions to a moved project directory", async () => {
    const studioRoots = await roots()
    const metadata = studioSessionMetadata({
      key: "cad:box",
      kind: "cad-project",
      studioId: "cad",
      projectId: "box",
      relativePath: "box",
      label: "CAD · box",
    })
    const rows = [session({ id: "moved", directory: "/old/designs/box", updated: 100, metadata })]

    const result = await studioSessionHistory({ source: async () => rows, roots: studioRoots, scope: "studio" })

    expect(result.sessions[0]?.context).toMatchObject({
      directory: path.join(studioRoots.cad, "box"),
      historicalDirectory: "/old/designs/box",
      status: "moved",
    })
  })

  test("classifies Media project sessions", async () => {
    const studioRoots = await roots()
    const directory = path.join(studioRoots.media, "demo")
    const rows = [session({ id: "media", directory, updated: 100 })]

    const result = await studioSessionHistory({ source: async () => rows, roots: studioRoots, scope: "studio" })

    expect(result.sessions[0]?.context).toMatchObject({
      kind: "media-project",
      studioId: "media",
      projectId: "demo",
      relativePath: "demo",
      status: "available",
    })
  })

  test("exact scope filters by the resolved current directory", async () => {
    const studioRoots = await roots()
    const cadDirectory = path.join(studioRoots.cad, "box")
    const rows = [
      session({ id: "home", directory: studioRoots.home, updated: 200 }),
      session({ id: "cad", directory: cadDirectory, updated: 100 }),
    ]

    const result = await studioSessionHistory({
      source: async () => rows,
      roots: studioRoots,
      scope: "directory",
      directory: cadDirectory,
      contextKey: "cad:box",
    })

    expect(result.sessions.map((item) => item.id)).toEqual(["cad"])
  })
})
