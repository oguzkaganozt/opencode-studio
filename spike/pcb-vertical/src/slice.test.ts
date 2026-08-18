import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { currentGeneration, designDir } from "./host.ts"
import { createSpikeMastra } from "./workflow.ts"

test("Mastra slice: approve, DRC fail, correct, publish", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pcb-slice-"))
  const mastra = createSpikeMastra(`file:${path.join(root, "mastra.db")}`)
  const run = await mastra.getWorkflow("pcbSliceWorkflow").createRun()
  const started = await run.start({ inputData: { root, designId: "led-blink" } })
  assert.equal(started.status, "suspended")
  const result = await run.resume({
    step: "approve-plan",
    resumeData: { approved: true },
  })
  assert.equal(result.status, "success")
  if (result.status !== "success") return
  const report = JSON.parse(await readFile(path.join(designDir(root, "led-blink"), "qc-report.json"), "utf8")) as {
    complete: boolean
  }
  assert.equal(report.complete, true)
  assert.equal(await currentGeneration(root, "led-blink"), result.result.generation)
})

test("Mastra resume after new storage instance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pcb-resume-"))
  const db = `file:${path.join(root, "mastra.db")}`
  const first = createSpikeMastra(db)
  const firstRun = await first.getWorkflow("pcbSliceWorkflow").createRun()
  const started = await firstRun.start({ inputData: { root, designId: "resume-board" } })
  assert.equal(started.status, "suspended")
  const runId = firstRun.runId
  assert.ok(runId)
  const second = createSpikeMastra(db)
  const run = await second.getWorkflow("pcbSliceWorkflow").createRun({ runId })
  const resumed = await run.resume({
    step: "approve-plan",
    resumeData: { approved: true },
  })
  assert.equal(resumed.status, "success")
})
