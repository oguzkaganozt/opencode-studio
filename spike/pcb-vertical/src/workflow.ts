import { Mastra } from "@mastra/core/mastra"
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { LibSQLStore } from "@mastra/libsql"
import { z } from "zod"
import {
  applySource,
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

const inputSchema = z.object({
  root: z.string(),
  designId: z.string(),
})

const lockStep = createStep({
  id: "lock-intent",
  inputSchema,
  outputSchema: inputSchema.extend({ contractHash: z.string() }),
  execute: async ({ inputData }) => {
    const intent = await lockIntent(inputData.root, inputData.designId, ['name="R1"', 'name="C1"'])
    return { ...inputData, contractHash: intent.contractHash }
  },
})

const approveStep = createStep({
  id: "approve-plan",
  inputSchema: lockStep.outputSchema,
  outputSchema: lockStep.outputSchema,
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData?.approved) {
      return await suspend({ reason: "board intent requires approval" })
    }
    return inputData
  },
})

const designStep = createStep({
  id: "design-and-verify",
  inputSchema: lockStep.outputSchema,
  outputSchema: lockStep.outputSchema.extend({
    generation: z.string(),
    complete: z.boolean(),
    evidenceId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const generation = await startGeneration(inputData.root, inputData.designId)
    await applySource(inputData.root, inputData.designId, failSource(), sha256(""))
    const failed = await qcReport(inputData.root, inputData.designId, await runPcbTask(inputData.root, inputData.designId))
    if (failed.complete) {
      throw new Error("expected first DRC to fail")
    }
    await applySource(inputData.root, inputData.designId, passSource(), failed.sourceHash)
    const worker = await runPcbTask(inputData.root, inputData.designId)
    const passed = await qcReport(inputData.root, inputData.designId, worker)
    if (!passed.complete || worker.status !== "pass") {
      throw new Error(passed.blockers.join("; ") || "worker DRC failed")
    }
    await stageArtifact(inputData.root, inputData.designId, generation, `gerber ${passed.sourceHash}\n`)
    return { ...inputData, generation, complete: true, evidenceId: passed.evidenceId }
  },
})

const publishStep = createStep({
  id: "publish-artifact",
  inputSchema: designStep.outputSchema,
  outputSchema: z.object({
    designId: z.string(),
    generation: z.string(),
    evidenceId: z.string(),
  }),
  execute: async ({ inputData }) => {
    await publish(inputData.root, inputData.designId, inputData.generation)
    return {
      designId: inputData.designId,
      generation: inputData.generation,
      evidenceId: inputData.evidenceId,
    }
  },
})

export const pcbSliceWorkflow = createWorkflow({
  id: "pcb-vertical-slice",
  inputSchema,
  outputSchema: publishStep.outputSchema,
})
  .then(lockStep)
  .then(approveStep)
  .then(designStep)
  .then(publishStep)
  .commit()

export function createSpikeMastra(dbUrl: string): Mastra {
  return new Mastra({
    workflows: { pcbSliceWorkflow },
    storage: new LibSQLStore({
      id: "pcb-spike",
      url: dbUrl,
    }),
  })
}
