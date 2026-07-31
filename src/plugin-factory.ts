import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { allStudioIds, maybeMigrateLegacyConfig, readStudioConfigFile, resolveStudioRoot } from "./config"
import { ensureForgeRuntimeDir, loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { composeStudioPlugins, type StudioPluginContribution } from "./core/plugin-compose"
import { PLATFORM_OWNER } from "./core/registry"
import { assertNotRoot } from "./core/security"
import { pickUserPaths, type UserPathOptions } from "./core/user-paths"
import { ensureStudioHost, rebindStudioHostWorkspace } from "./host-ensure"
import { loadPlatformMediaPlugin, pluginLoaders } from "./studio-loaders"

export type StudioPluginOptions = UserPathOptions & {
  workspace?: string
  hostUrl?: string
  packageRoot?: string
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
    const href = typeof raw === "string" ? raw : raw.href
    if (!href) return undefined
    void new URL(href)
    return href.replace(/\/$/, "")
  } catch {
    return undefined
  }
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function sessionDirectoryFromEvent(event: { type: string; properties?: unknown }): string | undefined {
  if (event.type !== "session.created" && event.type !== "session.updated") return undefined
  const props = event.properties as { info?: { directory?: unknown } } | undefined
  const directory = props?.info?.directory
  return typeof directory === "string" && path.isAbsolute(directory) ? path.resolve(directory) : undefined
}

export function createOpenCodeStudioPlugin(defaults: StudioPluginOptions = {}): Plugin {
  return async (context, rawOptions) => {
    assertNotRoot("initialize the OpenCode Studio plugin")
    const packageRoot = defaults.packageRoot ?? packageRootFrom(import.meta.dir)
    const meta = await loadPackageMeta(packageRoot)
    const userPaths = pickUserPaths(defaults)
    const workspace = path.resolve(
      pickString(rawOptions?.workspace, defaults.workspace, context.directory) ?? process.env.HOME ?? process.cwd(),
    )

    let hostUrl = pickString(rawOptions?.hostUrl, defaults.hostUrl)?.replace(/\/$/, "")

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
            console.error(`[opencode-studio] Studio host ready: ${ensured.studioUrl} (workspace ${ensured.workspace})`)
          }
        } else {
          console.error(`[opencode-studio] Studio host not started: ${ensured.reason}`)
        }
      } else {
        console.error("[opencode-studio] Studio host skipped: no parent OpenCode serverUrl (use opencode serve)")
      }
    }

    // Explicit override only — never invent DEFAULT_STUDIO_HOST_URL after a failed ensure.
    if (!hostUrl) {
      const fromEnv = process.env.OPENCODE_STUDIO_URL?.trim().replace(/\/$/, "")
      if (fromEnv) hostUrl = fromEnv
    }

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

    const studioHooks = await Promise.all(
      allStudioIds().map(async (studioId) => {
        try {
          const plugin = await pluginLoaders[studioId](loadCtx)
          return { studioId, hooks: await plugin(context, {}) }
        } catch (loadError) {
          const message = loadError instanceof Error ? loadError.message : String(loadError)
          console.error(`[opencode-studio] failed to initialize studio "${studioId}": ${message}`)
          throw new Error(`opencode-studio: failed to initialize studio "${studioId}": ${message}`)
        }
      }),
    )
    contributions.push(...studioHooks)

    const composed = composeStudioPlugins(contributions)
    const previousEvent = composed.event
    composed.event = async (input) => {
      await previousEvent?.(input)
      const directory = sessionDirectoryFromEvent(input.event as { type: string; properties?: unknown })
      if (!directory) return
      try {
        const ok = await rebindStudioHostWorkspace(directory)
        if (ok) console.error(`[opencode-studio] active workspace → ${directory}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[opencode-studio] session workspace rebind failed: ${message}`)
      }
    }
    return composed
  }
}
