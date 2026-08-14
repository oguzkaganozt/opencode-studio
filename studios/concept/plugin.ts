import type { Plugin } from "@opencode-ai/plugin"
import { type ConceptPluginOptions, createConceptStudioPlugin } from "./tools"

export function loadConceptPlugin(input: { root: string } & Omit<ConceptPluginOptions, "workspaceRoot">): Plugin {
  return createConceptStudioPlugin({
    workspaceRoot: input.root,
    generateImage: input.generateImage,
  })
}
