import type { Plugin } from "@opencode-ai/plugin"
import { createStudioPlugin } from "./tools"

export type CadPluginContext = {
  root: string
  companionUrl: string
  forgeProjectDir: string
}

export function loadCadPlugin(ctx: CadPluginContext): Plugin {
  const plugin = createStudioPlugin()
  return async (context, _rawOptions) =>
    plugin(context, {
      studioRoot: ctx.root,
      companionUrl: ctx.companionUrl,
      forgeProjectDir: ctx.forgeProjectDir,
    })
}
