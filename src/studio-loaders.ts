import type { Plugin } from "@opencode-ai/plugin"
import type { Hono } from "hono"
import type { resolveStudioRoot } from "./config"
import { CATALOG_ORDER, STUDIO_IDS, type StudioId } from "./core/registry"

export type PluginLoadContext = {
  workspace: string
  roots: Parameters<typeof resolveStudioRoot>[0]["roots"]
  hostUrl: string
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
    const root = await ctx.resolveStudioRoot({ studioId: "cad", workspace: ctx.workspace, roots: ctx.roots, createMedia: false })
    return loadCadPlugin({
      root,
      companionUrl: `${ctx.hostUrl}/studio/studios/cad`,
      forgeProjectDir: await ctx.ensureForgeRuntimeDir(ctx.packageRoot),
    })
  },
  media: async (ctx) => {
    const { loadMediaPlugin } = await import("../studios/media/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "media", workspace: ctx.workspace, roots: ctx.roots, createMedia: true })
    return loadMediaPlugin({
      libraryRoot: root,
      providerPackage: ctx.mediaProviderPackage,
    })
  },
  pcb: async (ctx) => {
    const { loadPcbPlugin } = await import("../studios/pcb/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", workspace: ctx.workspace, roots: ctx.roots, createMedia: false })
    return loadPcbPlugin({ root })
  },
  startup: async (ctx) => {
    const { loadStartupPlugin } = await import("../studios/startup/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "startup", workspace: ctx.workspace, roots: ctx.roots, createMedia: false })
    return loadStartupPlugin({
      root,
      companionUrl: `${ctx.hostUrl}/studio/studios/startup`,
    })
  },
}

export const apiLoaders: Record<StudioId, ApiLoader> = {
  cad: async (ctx) => {
    const [{ createCadApi }, { initializeStudio }] = await Promise.all([import("../studios/cad/api"), import("../studios/cad/library")])
    const root = await ctx.resolveStudioRoot({ studioId: "cad", workspace: ctx.workspace, roots: ctx.roots })
    const layout = await initializeStudio(root)
    return createCadApi(layout)
  },
  media: async (ctx) => {
    const { createMediaApi } = await import("../studios/media/api")
    const root = await ctx.resolveStudioRoot({ studioId: "media", workspace: ctx.workspace, roots: ctx.roots, createMedia: true })
    return createMediaApi(root)
  },
  pcb: async (ctx) => {
    const { createPcbApi } = await import("../studios/pcb/api")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", workspace: ctx.workspace, roots: ctx.roots })
    return createPcbApi(root)
  },
  startup: async (ctx) => {
    const { createStartupApi } = await import("../studios/startup/api")
    const root = await ctx.resolveStudioRoot({ studioId: "startup", workspace: ctx.workspace, roots: ctx.roots })
    return createStartupApi(root)
  },
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
