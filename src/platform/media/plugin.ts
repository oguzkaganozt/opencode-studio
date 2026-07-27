import type { Plugin } from "@opencode-ai/plugin"
import { AnthropicNativeMediaProviderPlugin, createMediaStudioPlugin } from "./tools"

export type MediaPluginContext = {
  workspaceRoot: string
  providerPackage: string
}

export function loadMediaPlugin(ctx: MediaPluginContext): Plugin {
  const plugin = createMediaStudioPlugin()
  return async (context, _rawOptions) =>
    plugin(context, {
      libraryRoot: ctx.workspaceRoot,
      workspaceRoot: ctx.workspaceRoot,
      providerPackage: ctx.providerPackage,
    })
}

export function loadMediaGoProviderPlugin(ctx: { providerPackage: string }): Plugin {
  return async (context, _rawOptions) =>
    AnthropicNativeMediaProviderPlugin(context, {
      providerPackage: ctx.providerPackage,
    })
}

export { AnthropicNativeMediaProviderPlugin }
