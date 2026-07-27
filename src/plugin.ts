import type { Plugin } from "@opencode-ai/plugin"
import { allStudioIds, maybeMigrateLegacyConfig, readStudioConfigFile, resolveStudioRoot } from "./config"
import { ensureForgeRuntimeDir, loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { composeStudioPlugins, type StudioPluginContribution } from "./core/plugin-compose"
import { PLATFORM_OWNER } from "./core/registry"
import { assertNotRoot } from "./core/security"
import { pickUserPaths, type UserPathOptions } from "./core/user-paths"
import { loadPlatformMediaPlugin, pluginLoaders } from "./studio-loaders"

const DEFAULT_HOST_URL = "http://127.0.0.1:4173"

function hostUrlFromEnv() {
  const value = process.env.OPENCODE_STUDIO_URL
  if (typeof value === "string" && value.length > 0) return value.replace(/\/$/, "")
  return DEFAULT_HOST_URL
}

export type StudioPluginOptions = UserPathOptions & {
  /** Domain data root override (CAD/PCB). Defaults to OpenCode context.directory. */
  workspace?: string
  hostUrl?: string
  packageRoot?: string
}

async function resolveRoots(userPaths: UserPathOptions = {}, domainRoot?: string) {
  if (domainRoot) {
    try {
      const migrated = await maybeMigrateLegacyConfig(domainRoot, userPaths)
      if (migrated.migrated) {
        console.error(
          `[opencode-studio] migrated roots from ${migrated.legacyPath} → ${migrated.config.configPath}. Run opencode-studio repair to finish cleanup.`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[opencode-studio] legacy config migration skipped: ${message}`)
    }
  }
  const config = await readStudioConfigFile(userPaths)
  if (config.error) {
    console.error(`[opencode-studio] studio.json error (domains still on): ${config.error}`)
  }
  return { roots: config.roots, error: config.error }
}

export function createOpenCodeStudioPlugin(defaults: StudioPluginOptions = {}): Plugin {
  return async (context, rawOptions) => {
    assertNotRoot("initialize the OpenCode Studio plugin")
    const packageRoot = defaults.packageRoot ?? packageRootFrom(import.meta.dir)
    const meta = await loadPackageMeta(packageRoot)
    const userPaths = pickUserPaths(defaults)
    const workspace =
      typeof rawOptions?.workspace === "string" && rawOptions.workspace.length > 0
        ? rawOptions.workspace
        : typeof defaults.workspace === "string"
          ? defaults.workspace
          : context.directory
    const hostUrl =
      typeof rawOptions?.hostUrl === "string" && rawOptions.hostUrl.length > 0
        ? rawOptions.hostUrl.replace(/\/$/, "")
        : (defaults.hostUrl ?? hostUrlFromEnv())

    const { roots } = await resolveRoots(userPaths, workspace)

    const contributions: StudioPluginContribution[] = []
    const loadCtx = {
      workspace,
      roots,
      hostUrl,
      packageRoot,
      mediaProviderPackage: meta.mediaProviderSpecifier,
      resolveStudioRoot,
      ensureForgeRuntimeDir,
    }

    // Platform media is always on.
    try {
      const platformPlugin = await loadPlatformMediaPlugin({
        workspace,
        mediaProviderPackage: meta.mediaProviderSpecifier,
      })
      contributions.push({ studioId: PLATFORM_OWNER, hooks: await platformPlugin(context, {}) })
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError)
      console.error(`[opencode-studio] failed to initialize platform media: ${message}`)
      throw new Error(`opencode-studio: failed to initialize platform media: ${message}`)
    }

    // Domain studios are always on (full catalog).
    for (const studioId of allStudioIds()) {
      try {
        const load = pluginLoaders[studioId]
        const plugin = await load(loadCtx)
        contributions.push({ studioId, hooks: await plugin(context, {}) })
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        console.error(`[opencode-studio] failed to initialize studio "${studioId}": ${message}`)
        throw new Error(`opencode-studio: failed to initialize studio "${studioId}": ${message}`)
      }
    }

    return composeStudioPlugins(contributions)
  }
}

const OpenCodeStudioPlugin = createOpenCodeStudioPlugin()
export default OpenCodeStudioPlugin
