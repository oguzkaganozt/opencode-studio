import type { Plugin } from "@opencode-ai/plugin"
import { createMediaStudioPlugin } from "./tools"

export function loadMediaPlugin(input: { root: string; providerPackage: string }): Plugin {
  const plugin = createMediaStudioPlugin()
  return (context, _options) =>
    plugin(context, {
      libraryRoot: input.root,
      providerPackage: input.providerPackage,
    })
}
