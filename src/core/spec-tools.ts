import { tool } from "@opencode-ai/plugin"
import { formatToolJson } from "./format-tool-json"
import type { SpecStudioId, StudioSpec } from "./spec"

export function createSpecTools(input: { owner: SpecStudioId; publish: (id: string, summary?: string) => Promise<StudioSpec> }) {
  const prefix = input.owner
  return {
    [`${prefix}_spec`]: tool({
      description: `Publish SPEC.json for this ${prefix} artifact. Other agents read the file with the stock read tool — they do not need this studio's design tools.`,
      args: {
        id: tool.schema.string().describe(`${prefix === "cad" ? "Design" : "Project"} id`),
        summary: tool.schema.string().optional().describe("Optional one-line human summary"),
      },
      async execute(args) {
        return formatToolJson(await input.publish(args.id, args.summary))
      },
    }),
  }
}
