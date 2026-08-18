import { Agent } from "@mastra/core/agent"
import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { applySource, failSource, lockIntent, passSource, qcReport, sha256 } from "./host.ts"
import { runPcbTask } from "./worker.ts"

export const PROVIDERS = {
  openai: "openai/gpt-4o-mini",
  xai: "xai/grok-3",
} as const

export type ProviderId = keyof typeof PROVIDERS

export function modelFor(provider: ProviderId): string {
  return PROVIDERS[provider]
}

export function createPcbTools(root: string, designId: string) {
  return {
    applyPass: createTool({
      id: "pcb-apply-pass",
      description: "Apply the passing board source",
      inputSchema: z.object({ baseHash: z.string() }),
      outputSchema: z.object({ sourceHash: z.string() }),
      execute: async ({ baseHash }) => applySource(root, designId, passSource(), baseHash),
    }),
    applyFail: createTool({
      id: "pcb-apply-fail",
      description: "Apply the overlapping-footprint board source",
      inputSchema: z.object({ baseHash: z.string() }),
      outputSchema: z.object({ sourceHash: z.string() }),
      execute: async ({ baseHash }) => applySource(root, designId, failSource(), baseHash),
    }),
    verify: createTool({
      id: "pcb-verify",
      description: "Run tscircuit DRC and host QC",
      inputSchema: z.object({}),
      outputSchema: z.object({
        complete: z.boolean(),
        blockers: z.array(z.string()),
        sourceHash: z.string(),
      }),
      execute: async () => qcReport(root, designId, await runPcbTask(root, designId)),
    }),
  }
}

export function createPcbAgent(input: { provider: ProviderId; root: string; designId: string }): Agent {
  return new Agent({
    id: "pcb-agent",
    name: "PCB agent",
    instructions: "Use only pcb tools. Never claim complete without verify.",
    model: modelFor(input.provider),
    tools: createPcbTools(input.root, input.designId),
  })
}

export async function seedBoard(root: string, designId: string): Promise<string> {
  await lockIntent(root, designId, ['name="R1"', 'name="C1"'])
  return sha256("")
}
