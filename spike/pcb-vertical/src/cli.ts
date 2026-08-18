import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { currentGeneration } from "./host.ts"
import { createSpikeMastra } from "./workflow.ts"

const root = await mkdtemp(path.join(tmpdir(), "pcb-cli-"))
try {
  const mastra = createSpikeMastra(`file:${path.join(root, "mastra.db")}`)
  const run = await mastra.getWorkflow("pcbSliceWorkflow").createRun()
  const started = await run.start({ inputData: { root, designId: "cli-board" } })
  if (started.status !== "suspended") {
    throw new Error(`expected suspend, got ${started.status}`)
  }
  const result = await run.resume({
    step: "approve-plan",
    resumeData: { approved: true },
  })
  if (result.status !== "success") {
    throw new Error(`slice failed: ${result.status}`)
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        generation: result.result.generation,
        evidenceId: result.result.evidenceId,
        current: await currentGeneration(root, "cli-board"),
      },
      null,
      2,
    ),
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
