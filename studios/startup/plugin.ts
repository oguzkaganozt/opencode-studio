import type { Plugin } from "@opencode-ai/plugin"
import { StartupStudioPlugin } from "./tools"

export type StartupPluginContext = {
  root: string
  companionUrl: string
}

export function loadStartupPlugin(ctx: StartupPluginContext): Plugin {
  return async (context, _rawOptions) =>
    StartupStudioPlugin(context, {
      dataRoot: ctx.root,
      companionUrl: ctx.companionUrl,
    })
}
