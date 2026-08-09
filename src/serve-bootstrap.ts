import path from "node:path"
import { packageRootFrom } from "./core/paths"
import { autostartDisabled, ensureStudioHost, probeParentOpenCode } from "./host-ensure"
import { ensureOpenCodeServer, stopOwnedOpenCode } from "./opencode-supervisor"

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
  const fromEnv = env.OPENCODE_STUDIO_PARENT?.trim() || env.OPENCODE_SERVER_URL?.trim() || env.OPENCODE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  const port = env.OPENCODE_PORT?.trim() || env.OPENCODE_SERVER_PORT?.trim() || "4096"
  const publicBind = Boolean(env.OPENCODE_SERVER_PASSWORD || env.OPENCODE_STUDIO_PASSWORD || env.OPENCODE_STUDIO_BIND)
  const host = env.OPENCODE_STUDIO_PARENT_HOST?.trim() || (publicBind ? "0.0.0.0" : "127.0.0.1")
  return `http://${host}:${port}`
}

/**
 * Ensure OpenCode API (attach or spawn), then Studio host.
 * Primary product entry for supervised mode.
 */
export async function runStudioUp(options?: {
  packageRoot?: string
  env?: NodeJS.ProcessEnv
  pollMs?: number
}): Promise<{ ok: true; studioUrl: string; parentUrl: string } | { ok: false; reason: string }> {
  const env = options?.env ?? process.env
  if (autostartDisabled(env.OPENCODE_STUDIO_AUTOSTART)) {
    return { ok: false, reason: "OPENCODE_STUDIO_AUTOSTART disabled" }
  }
  const packageRoot = options?.packageRoot ?? packageRootFrom(import.meta.dir)
  const studioRoot = defaultStudioRoot(env)

  const supervised = await ensureOpenCodeServer(env)
  if (!supervised.ok) return { ok: false, reason: supervised.reason }
  const parent = supervised.baseUrl
  if (supervised.spawned) {
    console.error(`[opencode-studio] OpenCode API supervised at ${parent} (pid ${supervised.pid ?? "?"})`)
  } else {
    console.error(`[opencode-studio] OpenCode API attached at ${parent}`)
  }
  // Watchdog starts inside ensure when we spawn; no-op for attach-only.

  const ensured = await ensureStudioHost({
    parentOpenCodeUrl: parent,
    studioRoot,
    packageRoot,
    env,
  })
  if (!ensured.ok) {
    await stopOwnedOpenCode({ permanent: true })
    return { ok: false, reason: ensured.reason }
  }
  console.error(`[opencode-studio] Studio ready: ${ensured.studioUrl} studioRoot=${ensured.studioRoot}`)
  return { ok: true, studioUrl: ensured.studioUrl, parentUrl: parent }
}

/**
 * Start a fixed-root Studio host as soon as parent OpenCode is reachable.
 * Tries supervised spawn when parent is missing (unless OPENCODE_STUDIO_NO_SUPERVISE).
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
  let parent = defaultParentOpenCodeUrl(env)
  const studioRoot = defaultStudioRoot(env)

  if (!(await probeParentOpenCode(parent, env))) {
    const supervised = await ensureOpenCodeServer(env)
    if (supervised.ok) {
      parent = supervised.baseUrl
      console.error(`[opencode-studio] OpenCode ${supervised.spawned ? "spawned" : "attached"} at ${parent}`)
    } else {
      // Wait for external parent
      for (let i = 0; i < 100; i++) {
        if (await probeParentOpenCode(parent, env)) break
        if (i === 99) {
          console.error(`[opencode-studio] ensure-host: parent not reachable at ${parent} (${supervised.reason})`)
          return
        }
        await sleep(200)
      }
    }
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

  while (true) {
    await sleep(pollMs)
    if (!(await probeParentOpenCode(parent, env))) {
      if (exitWhenParentDown) {
        console.error("[opencode-studio] parent OpenCode gone; ensure-host exiting")
        await stopOwnedOpenCode({ permanent: true })
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
