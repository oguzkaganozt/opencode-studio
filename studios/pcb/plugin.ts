import type { Plugin } from "@opencode-ai/plugin"
import { createPcbStudioPlugin } from "./tools"

export type PcbPluginContext = {
  root: string
}

/**
 * PCB tools use the configured studio root (workspace-relative or absolute).
 */
export function loadPcbPlugin(ctx: PcbPluginContext): Plugin {
  return createPcbStudioPlugin({ workspaceRoot: ctx.root })
}
