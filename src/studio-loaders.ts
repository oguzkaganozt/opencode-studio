import type { Plugin } from "@opencode-ai/plugin"
import type { Hono } from "hono"
import type { resolveStudioRoot } from "./config"
import { CATALOG_ORDER, STUDIO_IDS, type StudioId } from "./core/registry"

export type PluginLoadContext = {
  workspace: string
  roots: Parameters<typeof resolveStudioRoot>[0]["roots"]
  /** Set only when ensure succeeded or hostUrl/OPENCODE_STUDIO_URL was explicit. */
  hostUrl?: string
  packageRoot: string
  mediaProviderPackage: string
  resolveStudioRoot: typeof resolveStudioRoot
  ensureForgeRuntimeDir: (packageRoot: string) => Promise<string>
}

export type ApiLoadContext = {
  workspace: string
  roots: Parameters<typeof resolveStudioRoot>[0]["roots"]
  resolveStudioRoot: typeof resolveStudioRoot
}

export type PluginLoader = (ctx: PluginLoadContext) => Promise<Plugin>
export type ApiLoader = (ctx: ApiLoadContext) => Promise<Hono>

export const pluginLoaders: Record<StudioId, PluginLoader> = {
  cad: async (ctx) => {
    const { loadCadPlugin } = await import("../studios/cad/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "cad", workspace: ctx.workspace, roots: ctx.roots })
    return loadCadPlugin({
      root,
      companionUrl: ctx.hostUrl ? `${ctx.hostUrl}/studio/studios/cad` : undefined,
      forgeProjectDir: await ctx.ensureForgeRuntimeDir(ctx.packageRoot),
    })
  },
  pcb: async (ctx) => {
    const { loadPcbPlugin } = await import("../studios/pcb/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", workspace: ctx.workspace, roots: ctx.roots })
    return loadPcbPlugin({ root })
  },
}

export const apiLoaders: Record<StudioId, ApiLoader> = {
  cad: async (ctx) => {
    const [{ createCadApi }, { initializeStudio }] = await Promise.all([import("../studios/cad/api"), import("../studios/cad/library")])
    const root = await ctx.resolveStudioRoot({ studioId: "cad", workspace: ctx.workspace, roots: ctx.roots })
    const layout = await initializeStudio(root)
    return createCadApi(layout)
  },
  pcb: async (ctx) => {
    const { createPcbApi } = await import("../studios/pcb/api")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", workspace: ctx.workspace, roots: ctx.roots })
    return createPcbApi(root)
  },
}

export async function loadPlatformMediaPlugin(ctx: { workspace: string; mediaProviderPackage: string }): Promise<Plugin> {
  const { loadMediaPlugin } = await import("./platform/media/plugin")
  return loadMediaPlugin({
    workspaceRoot: ctx.workspace,
    providerPackage: ctx.mediaProviderPackage,
  })
}

/** Ensures loader maps stay in lockstep with the catalog. */
export function assertLoaderCoverage() {
  for (const id of STUDIO_IDS) {
    if (!(id in pluginLoaders)) throw new Error(`pluginLoaders missing ${id}`)
    if (!(id in apiLoaders)) throw new Error(`apiLoaders missing ${id}`)
  }
  for (const id of CATALOG_ORDER) {
    if (!(id in pluginLoaders) || !(id in apiLoaders)) {
      throw new Error(`loaders incomplete for catalog id ${id}`)
    }
  }
  const pluginKeys = Object.keys(pluginLoaders).sort().join(",")
  const apiKeys = Object.keys(apiLoaders).sort().join(",")
  const catalogKeys = [...STUDIO_IDS].sort().join(",")
  if (pluginKeys !== catalogKeys) throw new Error(`pluginLoaders keys mismatch: ${pluginKeys} vs ${catalogKeys}`)
  if (apiKeys !== catalogKeys) throw new Error(`apiLoaders keys mismatch: ${apiKeys} vs ${catalogKeys}`)
}
