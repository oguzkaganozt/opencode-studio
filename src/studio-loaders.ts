import type { Plugin } from "@opencode-ai/plugin"
import type { Hono } from "hono"
import type { resolveStudioRoot } from "./config"
import { assertCatalogComplete, type StudioId } from "./core/registry"
import { resolveSpecRoots } from "./core/spec"

export type PluginLoadContext = {
  studioRoot: string
  roots: Parameters<typeof resolveStudioRoot>[0]["roots"]
  /** Set only when ensure succeeded or hostUrl/OPENCODE_STUDIO_URL was explicit. */
  hostUrl?: string
  packageRoot: string
  resolveStudioRoot: typeof resolveStudioRoot
  ensureCadEngineDir: (packageRoot: string) => Promise<string>
}

export type ApiLoadContext = {
  studioRoot: string
  roots: Parameters<typeof resolveStudioRoot>[0]["roots"]
  resolveStudioRoot: typeof resolveStudioRoot
}

export type PluginLoader = (ctx: PluginLoadContext) => Promise<Plugin>
export type ApiLoader = (ctx: ApiLoadContext) => Promise<Hono>

export const pluginLoaders: Record<StudioId, PluginLoader> = {
  concept: async (ctx) => {
    const { loadConceptPlugin } = await import("../studios/concept/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "concept", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return loadConceptPlugin({ root })
  },
  cad: async (ctx) => {
    const { loadCadPlugin } = await import("../studios/cad/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "cad", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return loadCadPlugin({
      root,
      companionUrl: ctx.hostUrl ? `${ctx.hostUrl}/studio/studios/cad` : undefined,
      engineProjectDir: await ctx.ensureCadEngineDir(ctx.packageRoot),
      specRoots: await resolveSpecRoots(ctx),
    })
  },
  pcb: async (ctx) => {
    const { loadPcbPlugin } = await import("../studios/pcb/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return loadPcbPlugin({ root, specRoots: await resolveSpecRoots(ctx) })
  },
  fw: async (ctx) => {
    const { loadFwPlugin } = await import("../studios/fw/plugin")
    const root = await ctx.resolveStudioRoot({ studioId: "fw", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return loadFwPlugin({ root, specRoots: await resolveSpecRoots(ctx) })
  },
}

export const apiLoaders: Record<StudioId, ApiLoader> = {
  concept: async (ctx) => {
    const { createConceptApi } = await import("../studios/concept/api")
    const root = await ctx.resolveStudioRoot({ studioId: "concept", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return createConceptApi(root)
  },
  cad: async (ctx) => {
    const [{ createCadApi }, { initializeStudio }] = await Promise.all([
      import("../studios/cad/host/api"),
      import("../studios/cad/host/library"),
    ])
    const root = await ctx.resolveStudioRoot({ studioId: "cad", studioRoot: ctx.studioRoot, roots: ctx.roots })
    const layout = await initializeStudio(root)
    return createCadApi(layout)
  },
  pcb: async (ctx) => {
    const { createPcbApi } = await import("../studios/pcb/api")
    const root = await ctx.resolveStudioRoot({ studioId: "pcb", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return createPcbApi(root)
  },
  fw: async (ctx) => {
    const { createFwApi } = await import("../studios/fw/api")
    const root = await ctx.resolveStudioRoot({ studioId: "fw", studioRoot: ctx.studioRoot, roots: ctx.roots })
    return createFwApi(root)
  },
}

/** Ensures loader maps stay in lockstep with the catalog. */
export function assertLoaderCoverage() {
  assertCatalogComplete(Object.keys(pluginLoaders), "pluginLoaders")
  assertCatalogComplete(Object.keys(apiLoaders), "apiLoaders")
}
