import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { cadPartWorkerPrompt, partSourceIsStub, planCadDispatch, readPartSourceStatus } from "../host/dispatch"
import { cadRuntimeKey, closeCadRuntimeSession, getCadRuntimeSession } from "../tools/session"

describe("cad part dispatch plan", () => {
  test("keeps a single part serial", () => {
    expect(planCadDispatch(["body"])).toEqual({ mode: "serial", assigned: [], remaining: ["body"] })
  })

  test("assigns up to three parts in parallel", () => {
    expect(planCadDispatch(["a", "b", "c", "d"])).toEqual({
      mode: "parallel",
      assigned: ["a", "b", "c"],
      remaining: ["d"],
    })
  })
})

describe("cad part source status", () => {
  test("detects scaffold stubs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cad-dispatch-"))
    await mkdir(path.join(root, "parts"), { recursive: true })
    const stub = `"""Parametric source for body."""\n\ndef build():\n    raise NotImplementedError("Model body before cad_design_build")\n`
    await writeFile(path.join(root, "parts/body.py"), stub)
    await writeFile(path.join(root, "parts/lid.py"), "from params import BOX_L\n\ndef build():\n    return Box(BOX_L, 10, 10)\n")
    expect(partSourceIsStub(stub)).toBe(true)
    expect((await readPartSourceStatus(root, "parts/body.py")).ready).toBe(false)
    expect((await readPartSourceStatus(root, "parts/lid.py")).ready).toBe(true)
    expect(
      cadPartWorkerPrompt({
        designId: "box",
        partId: "body",
        source: "parts/body.py",
        directory: root,
        parentSessionID: "parent",
        brief: "Desk box",
        params: "BOX_L = 100",
      }),
    ).toContain("Desk box")
  })
})

describe("cad runtime session key", () => {
  test("isolates python runtimes by OpenCode session", async () => {
    const a = getCadRuntimeSession("/engine", "/cwd", "ses-a")
    const b = getCadRuntimeSession("/engine", "/cwd", "ses-b")
    const again = getCadRuntimeSession("/engine", "/cwd", "ses-a")
    expect(a).not.toBe(b)
    expect(a).toBe(again)
    expect(cadRuntimeKey("/engine", "/cwd", "ses-a")).toBe("/engine::/cwd::ses-a")
    await closeCadRuntimeSession("/engine", "/cwd", "ses-a")
    await closeCadRuntimeSession("/engine", "/cwd", "ses-b")
  })
})
