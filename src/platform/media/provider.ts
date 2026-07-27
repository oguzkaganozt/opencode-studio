import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { rewriteAnthropicVideoRequestBody, rewritePromptVideos, rewriteVideoRequestBody } from "./provider-internal"

type AnthropicSettings = NonNullable<Parameters<typeof createAnthropic>[0]>
type Settings = (Parameters<typeof createOpenAICompatible>[0] | AnthropicSettings) & {
  nativeMediaProtocol?: "anthropic" | "openai-compatible"
}

function wrapModel<T extends object>(model: T): T {
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property === "doGenerate" || property === "doStream") {
        const method = Reflect.get(target, property, target)
        if (typeof method !== "function") return method
        return (options: unknown) => Reflect.apply(method, target, [rewritePromptVideos(options)])
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

function createNativeMediaOpenAICompatible(settings: Parameters<typeof createOpenAICompatible>[0]) {
  const transform = settings.transformRequestBody
  const provider = createOpenAICompatible({
    ...settings,
    transformRequestBody(body) {
      const rewritten = rewriteVideoRequestBody(body)
      return transform ? transform(rewritten) : rewritten
    },
  })

  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === "languageModel" || property === "chatModel") {
        const factory = Reflect.get(target, property, target)
        if (typeof factory !== "function") return factory
        return (modelID: string) => wrapModel(Reflect.apply(factory, target, [modelID]))
      }
      return Reflect.get(target, property, receiver)
    },
    apply(target, thisArg, args: [string]) {
      return wrapModel(Reflect.apply(target, thisArg, args))
    },
  })
}

function createNativeMediaAnthropic(settings: AnthropicSettings) {
  const transport = settings.fetch ?? fetch
  const provider = createAnthropic({
    ...settings,
    fetch: (async (input, init) => {
      if (typeof init?.body !== "string") return transport(input, init)
      const body = rewriteAnthropicVideoRequestBody(JSON.parse(init.body))
      return transport(input, { ...init, body: JSON.stringify(body) })
    }) as typeof fetch,
  })

  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === "languageModel" || property === "chat" || property === "messages") {
        const factory = Reflect.get(target, property, target)
        if (typeof factory !== "function") return factory
        return (modelID: string) => wrapModel(Reflect.apply(factory, target, [modelID]))
      }
      return Reflect.get(target, property, receiver)
    },
    apply(target, thisArg, args: [string]) {
      return wrapModel(Reflect.apply(target, thisArg, args))
    },
  })
}

export function createNativeMediaProvider(settings: Settings) {
  const { nativeMediaProtocol = "openai-compatible", ...providerSettings } = settings
  return nativeMediaProtocol === "anthropic"
    ? createNativeMediaAnthropic(providerSettings)
    : createNativeMediaOpenAICompatible(providerSettings as Parameters<typeof createOpenAICompatible>[0])
}
