import type { Plugin } from "@opencode-ai/plugin"
import { allStudioIds, maybeMigrateLegacyConfig, readStudioConfigFile, resolveStudioRoot } from "./config"
import { ensureForgeRuntimeDir, loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { composeStudioPlugins, type StudioPluginContribution } from "./core/plugin-compose"
import { PLATFORM_OWNER } from "./core/registry"
import { assertNotRoot } from "./core/security"
import { pickUserPaths, type UserPathOptions } from "./core/user-paths"
import { DEFAULT_STUDIO_HOST_URL, ensureStudioHost } from "./host-ensure"
import { normalizeParentOpenCodeUrl } from "./opencode-bridge"
import { loadPlatformMediaPlugin, pluginLoaders } from "./studio-loaders"

export type StudioPluginOptions = UserPathOptions & {
  /** Domain data root override (CAD/PCB). Defaults to OpenCode context.directory. */
  workspace?: string
  hostUrl?: string
  packageRoot?: string
  /** When false, skip ensure-host (tests). Default true. */
  ensureHost?: boolean
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

function parentServerUrl(context: { serverUrl?: URL }): string | undefined {
  const raw = context.serverUrl
  if (!raw) return undefined
  try {
    return normalizeParentOpenCodeUrl(raw)
  } catch {
    return undefined
  }
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

    let hostUrl =
      typeof rawOptions?.hostUrl === "string" && rawOptions.hostUrl.length > 0
        ? rawOptions.hostUrl.replace(/\/$/, "")
        : typeof defaults.hostUrl === "string"
          ? defaults.hostUrl.replace(/\/$/, "")
          : undefined

    const shouldEnsure = defaults.ensureHost !== false && rawOptions?.ensureHost !== false
    if (!hostUrl && shouldEnsure) {
      const parent = parentServerUrl(context)
      if (parent) {
        const ensured = await ensureStudioHost({
          parentOpenCodeUrl: parent,
          workspace,
          packageRoot,
          env: process.env,
        })
        if (ensured.ok) {
          hostUrl = ensured.hostUrl
          if (!ensured.reused) {
            console.error(`[opencode-studio] Studio host ready: ${ensured.studioUrl}`)
          }
        } else {
          console.error(`[opencode-studio] Studio host not started: ${ensured.reason}`)
        }
      } else {
        console.error("[opencode-studio] Studio host skipped: no parent OpenCode serverUrl (use opencode serve)")
      }
    }

    // Prefer explicit env; otherwise default :4173 so tools can probe companion health.
    // Ensure failure is already logged — design_view reports reachable:false if host is down.
    hostUrl = hostUrl ?? process.env.OPENCODE_STUDIO_URL?.replace(/\/$/, "") ?? DEFAULT_STUDIO_HOST_URL

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
