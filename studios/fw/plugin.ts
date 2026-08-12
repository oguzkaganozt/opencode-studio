import type { Plugin } from "@opencode-ai/plugin"
import type { SpecRoots } from "../../src/core/spec"
import { createFwStudioPlugin } from "./tools"

export function loadFwPlugin(input: { root: string; specRoots?: SpecRoots }): Plugin {
  return createFwStudioPlugin({ workspaceRoot: input.root, specRoots: input.specRoots })
}
