import type { Plugin } from "@opencode-ai/plugin"
import type { SpecRoots } from "../../src/core/spec"
import { createPcbStudioPlugin } from "./tools"

export type PcbPluginContext = {
  root: string
  specRoots?: SpecRoots
}

/**
 * PCB tools use the configured studio root (workspace-relative or absolute).
 */
export function loadPcbPlugin(ctx: PcbPluginContext): Plugin {
  return createPcbStudioPlugin({ workspaceRoot: ctx.root, specRoots: ctx.specRoots })
}
