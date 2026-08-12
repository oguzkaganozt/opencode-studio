import type { Plugin } from "@opencode-ai/plugin"
import type { SpecRoots } from "../../src/core/spec"
import { createStudioPlugin } from "./tools"

export type CadPluginContext = {
  root: string
  companionUrl?: string
  engineProjectDir: string
  specRoots?: SpecRoots
}

export function loadCadPlugin(ctx: CadPluginContext): Plugin {
  const plugin = createStudioPlugin()
  return async (context, _rawOptions) =>
    plugin(context, {
      studioRoot: ctx.root,
      companionUrl: ctx.companionUrl,
      engineProjectDir: ctx.engineProjectDir,
      specRoots: ctx.specRoots,
    })
}
