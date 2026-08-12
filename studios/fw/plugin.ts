import type { Plugin } from "@opencode-ai/plugin"
import { createFwStudioPlugin } from "./tools"

export function loadFwPlugin(input: { root: string }): Plugin {
  return createFwStudioPlugin({ workspaceRoot: input.root })
}
