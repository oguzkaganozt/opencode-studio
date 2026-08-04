import path from "node:path"
import { packageRootFrom } from "./core/paths"
import { autostartDisabled, ensureStudioHost, probeParentOpenCode } from "./host-ensure"

const g = globalThis as typeof globalThis & { __opencodeStudioBootstrap?: boolean }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fixed filesystem root for one Studio host process. */
export function defaultStudioRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENCODE_STUDIO_WORKSPACE?.trim()
  if (explicit) return path.resolve(explicit)
  if (env.HOME) return path.resolve(env.HOME)
  return path.resolve(process.cwd())
}

/** Parent URL for ensure: inherit public bind when OpenCode password is set. */
export function defaultParentOpenCodeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.OPENCODE_STUDIO_PARENT?.trim() || env.OPENCODE_SERVER_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  const port = env.OPENCODE_PORT?.trim() || env.OPENCODE_SERVER_PORT?.trim() || "4096"
  const publicBind = Boolean(env.OPENCODE_SERVER_PASSWORD || env.OPENCODE_STUDIO_PASSWORD || env.OPENCODE_STUDIO_BIND)
  const host = env.OPENCODE_STUDIO_PARENT_HOST?.trim() || (publicBind ? "0.0.0.0" : "127.0.0.1")
  return `http://${host}:${port}`
}

/**
 * Start a fixed-root Studio host as soon as parent OpenCode is reachable.
 * OpenCode sessions choose their own request directory; they never change Studio Home.
 */
export async function runEnsureHostLoop(options?: {
  packageRoot?: string
  env?: NodeJS.ProcessEnv
  /** Exit when parent dies (default true for CLI ensure-host). */
  exitWhenParentDown?: boolean
  pollMs?: number
}): Promise<void> {
  const env = options?.env ?? process.env
  if (autostartDisabled(env.OPENCODE_STUDIO_AUTOSTART)) {
    console.error("[opencode-studio] ensure-host skipped (AUTOSTART disabled)")
    return
  }

  const packageRoot = options?.packageRoot ?? packageRootFrom(import.meta.dir)
  const pollMs = options?.pollMs ?? 2_000
  const exitWhenParentDown = options?.exitWhenParentDown !== false
  const parent = defaultParentOpenCodeUrl(env)
  const studioRoot = defaultStudioRoot(env)

  // Wait for parent
  for (let i = 0; i < 100; i++) {
    if (await probeParentOpenCode(parent, env)) break
    if (i === 99) {
      console.error(`[opencode-studio] ensure-host: parent not reachable at ${parent}`)
      return
    }
    await sleep(200)
  }

  const ensured = await ensureStudioHost({
    parentOpenCodeUrl: parent,
    studioRoot,
    packageRoot,
    env,
  })
  if (!ensured.ok) {
    console.error(`[opencode-studio] ensure-host failed: ${ensured.reason}`)
    return
  }
  console.error(`[opencode-studio] Studio host ready: ${ensured.studioUrl} studioRoot=${ensured.studioRoot}`)

  // Keep the companion alive only while its parent serve remains reachable.
  while (true) {
    await sleep(pollMs)
    if (!(await probeParentOpenCode(parent, env))) {
      if (exitWhenParentDown) {
        console.error("[opencode-studio] parent OpenCode gone; ensure-host exiting")
        return
      }
    }
  }
}

/**
 * Fire-and-forget bootstrap when the plugin module is imported inside OpenCode.
 * Retries until parent is up or timeout.
 */
export function scheduleServeBootstrap(options?: { packageRoot?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): void {
  if (g.__opencodeStudioBootstrap) return
  g.__opencodeStudioBootstrap = true

  const env = options?.env ?? process.env
  if (autostartDisabled(env.OPENCODE_STUDIO_AUTOSTART)) return

  const packageRoot = options?.packageRoot ?? packageRootFrom(import.meta.dir)
  const timeoutMs = options?.timeoutMs ?? 45_000
  const started = Date.now()

  void (async () => {
    while (Date.now() - started < timeoutMs) {
      const parent = defaultParentOpenCodeUrl(env)
      try {
        if (!(await probeParentOpenCode(parent, env))) {
          await sleep(300)
          continue
        }
        const studioRoot = defaultStudioRoot(env)
        const ensured = await ensureStudioHost({
          parentOpenCodeUrl: parent,
          studioRoot,
          packageRoot,
          env,
        })
        if (ensured.ok) {
          if (!ensured.reused) {
            console.error(`[opencode-studio] Studio host ready (bootstrap): ${ensured.studioUrl} studioRoot=${ensured.studioRoot}`)
          }
          return
        }
        if (/already uses|PASSWORD|AUTOSTART/i.test(ensured.reason)) {
          console.error(`[opencode-studio] bootstrap stopped: ${ensured.reason}`)
          return
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[opencode-studio] bootstrap error: ${message}`)
      }
      await sleep(300)
    }
  })()
}
