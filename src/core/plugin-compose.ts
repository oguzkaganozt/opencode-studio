import type { Plugin } from "@opencode-ai/plugin"
import { CATALOG_ORDER, type StudioId } from "./registry"

const KNOWN_HOOK_KEYS = new Set([
  "tool",
  "tool.definition",
  "tool.execute.before",
  "tool.execute.after",
  "event",
  "config",
  "auth",
  "provider",
  "chat.message",
  "chat.params",
  "chat.headers",
  "permission",
  "permission.ask",
  "command",
  "shell.env",
  "experimental.chat.system.transform",
  "experimental.chat.messages.transform",
  "experimental.session.compacting",
  "experimental.text.complete",
])

const MUTABLE_TRANSFORMS = new Set([
  "tool.definition",
  "tool.execute.before",
  "tool.execute.after",
  "config",
  "chat.message",
  "chat.params",
  "chat.headers",
  "experimental.chat.system.transform",
  "experimental.chat.messages.transform",
  "experimental.session.compacting",
  "experimental.text.complete",
  "permission",
  "permission.ask",
  "shell.env",
])

const SINGLETON_KEYS = new Set(["provider", "auth"])

export type StudioPluginContribution = {
  studioId: StudioId
  hooks: Awaited<ReturnType<Plugin>>
}

function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === "function"
}

function composeSequential(handlers: Array<(...args: any[]) => any>) {
  return async (...args: any[]) => {
    let last: unknown
    for (const handler of handlers) {
      last = await handler(...args)
    }
    return last
  }
}

function composeDispose(handlers: Array<(...args: any[]) => any>) {
  return async (...args: any[]) => {
    for (const handler of [...handlers].reverse()) {
      await handler(...args)
    }
  }
}

export function composeStudioPlugins(contributions: StudioPluginContribution[]): Awaited<ReturnType<Plugin>> {
  const ordered = [...contributions].sort((a, b) => CATALOG_ORDER.indexOf(a.studioId) - CATALOG_ORDER.indexOf(b.studioId))
  const tools: Record<string, unknown> = {}
  const toolOwners = new Map<string, StudioId>()
  const hookBuckets = new Map<string, Array<{ studioId: StudioId; handler: unknown }>>()
  const singletons = new Map<string, StudioId>()

  for (const contribution of ordered) {
    const hooks = contribution.hooks as Record<string, unknown>
    for (const [key, value] of Object.entries(hooks)) {
      if (value === undefined) continue
      if (!KNOWN_HOOK_KEYS.has(key) && key !== "dispose") {
        throw new Error(`Unknown OpenCode hook key "${key}" from studio "${contribution.studioId}"`)
      }
      if (key === "tool") {
        const map = value as Record<string, unknown>
        for (const [toolName, toolDef] of Object.entries(map)) {
          const owner = toolOwners.get(toolName)
          if (owner) {
            throw new Error(`Duplicate tool "${toolName}" from studios "${owner}" and "${contribution.studioId}"`)
          }
          toolOwners.set(toolName, contribution.studioId)
          tools[toolName] = toolDef
        }
        continue
      }
      if (SINGLETON_KEYS.has(key)) {
        // Media is allowed to contribute distinct provider ids via auxiliary export;
        // within one composed plugin, only one provider object is supported.
        const owner = singletons.get(key)
        if (owner && owner !== contribution.studioId) {
          throw new Error(`Conflicting singleton hook "${key}" from studios "${owner}" and "${contribution.studioId}"`)
        }
        if (owner && owner === contribution.studioId && key === "provider") {
          throw new Error(
            `Studio "${contribution.studioId}" contributed multiple provider hooks in one plugin; use the Media auxiliary export for opencode-go`,
          )
        }
        singletons.set(key, contribution.studioId)
      }
      const bucket = hookBuckets.get(key) ?? []
      bucket.push({ studioId: contribution.studioId, handler: value })
      hookBuckets.set(key, bucket)
    }
  }

  const composed: Record<string, unknown> = {}
  if (Object.keys(tools).length > 0) composed.tool = tools

  for (const [key, bucket] of hookBuckets) {
    if (key === "dispose") {
      const handlers = bucket.map((item) => item.handler).filter(isFunction)
      if (handlers.length === 1) composed.dispose = handlers[0]
      else if (handlers.length > 1) composed.dispose = composeDispose(handlers)
      continue
    }
    if (SINGLETON_KEYS.has(key)) {
      composed[key] = bucket[0]!.handler
      continue
    }
    if (key === "event" || key === "command") {
      const handlers = bucket.map((item) => item.handler).filter(isFunction)
      composed[key] = composeSequential(handlers)
      continue
    }
    if (MUTABLE_TRANSFORMS.has(key)) {
      const handlers = bucket.map((item) => item.handler).filter(isFunction)
      composed[key] = composeSequential(handlers)
      continue
    }
    if (bucket.length === 1) {
      composed[key] = bucket[0]!.handler
      continue
    }
    const handlers = bucket.map((item) => item.handler).filter(isFunction)
    if (handlers.length === bucket.length) {
      composed[key] = composeSequential(handlers)
      continue
    }
    throw new Error(`Cannot compose non-function hook "${key}" from multiple studios`)
  }

  return composed as Awaited<ReturnType<Plugin>>
}

export function listComposedToolNames(composed: Awaited<ReturnType<Plugin>>) {
  const tools = (composed as { tool?: Record<string, unknown> }).tool
  return tools ? Object.keys(tools).sort() : []
}
