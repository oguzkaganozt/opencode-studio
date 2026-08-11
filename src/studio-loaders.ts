import type { Plugin } from "@opencode-ai/plugin"
import type { Hono } from "hono"
import type { resolveStudioRoot } from "./config"
import { assertCatalogComplete, type StudioId } from "./core/registry"

export type PluginLoadContext = {
  studioRoot: string
  roots: Parameters<typeof resolveStudioRoot>[0]["roots"]
  /** Set only when ensure succeeded or hostUrl/OPENCODE_STUDIO_URL was explicit. */
  hostUrl?: string
  packageRoot: string
  mediaProviderPackage: string
  resolveStudioRoot: typeof resolveStudioRoot
  ensureForgeRuntimeDir: (packageRoot: string) => Promise<string>
}

export type ApiLoadContext = {
  studioRoot: string
  roots: Parameters<typeof resolveStudioRoot>[0]["roots"]
  resolveStudioRoot: typeof resolveStudioRoot
}

export type PluginLoader = (ctx: PluginLoadContext) => Promise<Plugin>
export type ApiLoader = (ctx: ApiLoadContext) => Promise<Hono>

export const pluginLoaders: Record<StudioId, PluginLoader> = {
  cad: async (ctx) => {
    const { loadCadPlugin } = await import("../studios/cad/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "cad", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return loadCadPlugin({
      root,
      companionUrl: ctx.hostUrl ? `${ctx.hostUrl}/studio/studios/cad` : undefined,
      forgeProjectDir: await ctx.ensureForgeRuntimeDir(ctx.packageRoot),
    })
  },
  pcb: async (ctx) => {
    const { loadPcbPlugin } = await import("../studios/pcb/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return loadPcbPlugin({ root })
  },
  media: async (ctx) => {
    const { loadMediaPlugin } = await import("../studios/media/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "media", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return loadMediaPlugin({ root, providerPackage: ctx.mediaProviderPackage })
  },
}

export const apiLoaders: Record<StudioId, ApiLoader> = {
  cad: async (ctx) => {
    const [{ createCadApi }, { initializeStudio }] = await Promise.all([import("../studios/cad/api"), import("../studios/cad/library")])
    const root = await ctx.resolveStudioRoot({ studioId: "cad", studioRoot: ctx.studioRoot, roots: ctx.roots })
    const layout = await initializeStudio(root)
    return createCadApi(layout)
  },
  pcb: async (ctx) => {
    const { createPcbApi } = await import("../studios/pcb/api")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return createPcbApi(root)
  },
  media: async (ctx) => {
    const { createMediaApi } = await import("../studios/media/api")
    const root = await ctx.resolveStudioRoot({ studioId: "media", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return createMediaApi(root)
  },
}

/** Ensures loader maps stay in lockstep with the catalog. */
export function assertLoaderCoverage() {
  assertCatalogComplete(Object.keys(pluginLoaders), "pluginLoaders")
  assertCatalogComplete(Object.keys(apiLoaders), "apiLoaders")
}
