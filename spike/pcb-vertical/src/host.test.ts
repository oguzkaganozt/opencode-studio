import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  abortGeneration,
  applySource,
  currentGeneration,
  failSource,
  lockIntent,
  passSource,
  publish,
  qcReport,
  sha256,
  stageArtifact,
  startGeneration,
} from "./host.ts"
import { runPcbTask } from "./worker.ts"

test("apply rejects a stale hash and tscircuit DRC fails then passes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pcb-host-"))
  await lockIntent(root, "board", ['name="R1"', 'name="C1"'])
  await assert.rejects(applySource(root, "board", failSource(), "nope"), /hash mismatch/)
  const first = await applySource(root, "board", failSource(), sha256(""))
  const failed = await qcReport(root, "board", await runPcbTask(root, "board"))
  assert.equal(failed.complete, false)
  assert.ok(failed.blockers.some((item) => item.includes("overlap") || item.includes("coverage")))
  await applySource(root, "board", passSource(), first.sourceHash)
  const passed = await qcReport(root, "board", await runPcbTask(root, "board"))
  assert.equal(passed.complete, true, passed.blockers.join("; "))
})

test("abort cannot publish and incomplete QC cannot publish", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pcb-abort-"))
  await lockIntent(root, "board", ['name="R1"', 'name="C1"'])
  await applySource(root, "board", failSource(), sha256(""))
  await qcReport(root, "board", await runPcbTask(root, "board"))
  const generation = await startGeneration(root, "board")
  await stageArtifact(root, "board", generation, "partial")
  await assert.rejects(publish(root, "board", generation), /incomplete QC/)
  await abortGeneration(root, "board", generation)
  assert.equal(await currentGeneration(root, "board"), null)
})
