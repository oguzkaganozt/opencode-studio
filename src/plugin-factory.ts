import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { allStudioIds, maybeMigrateLegacyConfig, readStudioConfigFile, resolveStudioRoot } from "./config"
import { ensureCadEngineDir } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { composeStudioPlugins, type StudioPluginContribution } from "./core/plugin-compose"
import { PLATFORM_OWNER } from "./core/registry"
import { assertNotRoot } from "./core/security"
import { pickUserPaths, type UserPathOptions } from "./core/user-paths"
import { autostartDisabled } from "./host-ensure"
import { createImageGeneratePlugin } from "./platform/image/plugin"
import { defaultStudioRoot, ensureStudioHostReady } from "./serve-bootstrap"
import { pluginLoaders } from "./studio-loaders"

export type StudioPluginOptions = UserPathOptions & {
  /** Fixed Studio Home override for embedding and tests. */
  studioRoot?: string
  /** OpenCode project used only for legacy config migration. */
  workspace?: string
  hostUrl?: string
  packageRoot?: string
  ensureHost?: boolean
}

async function resolveRoots(userPaths: UserPathOptions = {}, legacyProjectRoot?: string) {
  if (legacyProjectRoot) {
    try {
      const migrated = await maybeMigrateLegacyConfig(legacyProjectRoot, userPaths)
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

export function createOpenCodeStudioPlugin(defaults: StudioPluginOptions = {}): Plugin {
  return async (context, rawOptions) => {
    assertNotRoot("initialize the OpenCode Studio plugin")
    const packageRoot = defaults.packageRoot ?? packageRootFrom(import.meta.dir)
    const userPaths = pickUserPaths(defaults)
    const agentWorkspace = path.resolve(
      pickString(rawOptions?.workspace, defaults.workspace, context.directory) ?? process.env.HOME ?? process.cwd(),
    )
    const studioRoot = path.resolve(pickString(rawOptions?.studioRoot, defaults.studioRoot) ?? defaultStudioRoot())
    // Legacy project config is migration input only; it never becomes the Studio Home.
    const { roots } = await resolveRoots(userPaths, agentWorkspace)

    let hostUrl = pickString(rawOptions?.hostUrl, defaults.hostUrl)?.replace(/\/$/, "")

    const shouldEnsure =
      defaults.ensureHost !== false && rawOptions?.ensureHost !== false && !autostartDisabled(process.env.OPENCODE_STUDIO_AUTOSTART)
    if (!hostUrl && shouldEnsure) {
      const parent = parentServerUrl(context)
      if (parent) {
        const ensured = await ensureStudioHostReady({
          parentOpenCodeUrl: parent,
          studioRoot,
          packageRoot,
          env: process.env,
        })
        if (ensured.ok) {
          hostUrl = ensured.hostUrl
          if (!ensured.reused) {
            console.error(`[opencode-studio] Studio host ready: ${ensured.studioUrl} (Studio Home ${ensured.studioRoot})`)
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

    const contributions: StudioPluginContribution[] = [{ studioId: PLATFORM_OWNER, hooks: await createImageGeneratePlugin()(context, {}) }]
    const loadCtx = {
      studioRoot,
      roots,
      hostUrl,
      packageRoot,
      resolveStudioRoot,
      ensureCadEngineDir,
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

    return composeStudioPlugins(contributions)
  }
}
