import type { Plugin } from "@opencode-ai/plugin"
import { shouldPatchNativeVideo } from "./native-compatibility"

function nativeMediaOptions(npm: string) {
  return {
    nativeMediaAdapter: npm,
    nativeMediaProtocol: npm === "@ai-sdk/anthropic" ? "anthropic" : "openai-compatible",
  } as const
}

function patchModels(provider: any, providerPackage: string) {
  return Object.fromEntries(
    Object.entries(provider.models).map(([id, value]) => {
      const model = value as any
      const npm = model.api.npm
      if (!shouldPatchNativeVideo({ providerID: "opencode-go", adapter: npm, video: model.capabilities.input.video })) return [id, model]
      return [
        id,
        {
          ...model,
          capabilities: { ...model.capabilities, input: { ...model.capabilities.input, video: true } },
          api: { ...model.api, npm: providerPackage },
          options: { ...model.options, ...nativeMediaOptions(npm) },
        },
      ]
    }),
  )
}

export function loadMediaGoProviderPlugin(ctx: { providerPackage: string }): Plugin {
  return async () => ({
    provider: {
      id: "opencode-go",
      async models(provider) {
        return patchModels(provider, ctx.providerPackage)
      },
    },
  })
}
