import path from "node:path"
import { defaultParentOpenCodeUrl } from "./core/opencode-bind"
import { packageRootFrom } from "./core/paths"
import { autostartDisabled, type EnsureStudioHostResult, ensureStudioHost, probeParentOpenCode } from "./host-ensure"
import { ensureOpenCodeServer, stopOwnedOpenCode } from "./opencode-supervisor"

export { defaultParentOpenCodeUrl }

const g = globalThis as typeof globalThis & { __opencodeStudioBootstrap?: boolean }

/** Fixed filesystem root for one Studio host process. */
export function defaultStudioRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENCODE_STUDIO_WORKSPACE?.trim()
  if (explicit) return path.resolve(explicit)
  if (env.HOME) return path.resolve(env.HOME)
  return path.resolve(process.cwd())
}

export type HostIdentity = {
  env: NodeJS.ProcessEnv
  packageRoot: string
  studioRoot: string
}

/** Shared packageRoot + Studio Home resolution for every host bring-up path. */
export function resolveHostIdentity(options?: { packageRoot?: string; studioRoot?: string; env?: NodeJS.ProcessEnv }): HostIdentity {
  const env = options?.env ?? process.env
  return {
    env,
    packageRoot: options?.packageRoot ?? packageRootFrom(import.meta.dir),
    studioRoot: path.resolve(options?.studioRoot ?? defaultStudioRoot(env)),
  }
}

/** Ensure Studio host with shared identity defaults. */
export async function ensureStudioHostReady(input: {
  parentOpenCodeUrl: string
  packageRoot?: string
  studioRoot?: string
  env?: NodeJS.ProcessEnv
}): Promise<EnsureStudioHostResult> {
  const id = resolveHostIdentity(input)
  return ensureStudioHost({
    parentOpenCodeUrl: input.parentOpenCodeUrl,
    studioRoot: id.studioRoot,
    packageRoot: id.packageRoot,
    env: id.env,
  })
}

/**
 * Ensure OpenCode API (attach or spawn), then Studio host.
 * Primary product entry for supervised mode.
 */
export async function runStudioUp(options?: {
  packageRoot?: string
  env?: NodeJS.ProcessEnv
}): Promise<{ ok: true; studioUrl: string; parentUrl: string } | { ok: false; reason: string }> {
  const id = resolveHostIdentity(options)
  if (autostartDisabled(id.env.OPENCODE_STUDIO_AUTOSTART)) {
    return { ok: false, reason: "OPENCODE_STUDIO_AUTOSTART disabled" }
  }

  const supervised = await ensureOpenCodeServer(id.env)
  if (!supervised.ok) return { ok: false, reason: supervised.reason }
  const parent = supervised.baseUrl
  if (supervised.spawned) {
    console.error(`[opencode-studio] OpenCode API supervised at ${parent} (pid ${supervised.pid ?? "?"})`)
  } else {
    console.error(`[opencode-studio] OpenCode API attached at ${parent}`)
  }

  const ensured = await ensureStudioHostReady({
    parentOpenCodeUrl: parent,
    packageRoot: id.packageRoot,
    studioRoot: id.studioRoot,
    env: id.env,
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
  const id = resolveHostIdentity(options)
  if (autostartDisabled(id.env.OPENCODE_STUDIO_AUTOSTART)) {
    console.error("[opencode-studio] ensure-host skipped (AUTOSTART disabled)")
    return
  }

  const pollMs = options?.pollMs ?? 2_000
  const exitWhenParentDown = options?.exitWhenParentDown !== false
  let parent = defaultParentOpenCodeUrl(id.env)

  if (!(await probeParentOpenCode(parent, id.env))) {
    const supervised = await ensureOpenCodeServer(id.env)
    if (supervised.ok) {
      parent = supervised.baseUrl
      console.error(`[opencode-studio] OpenCode ${supervised.spawned ? "spawned" : "attached"} at ${parent}`)
    } else {
      for (let i = 0; i < 100; i++) {
        if (await probeParentOpenCode(parent, id.env)) break
        if (i === 99) {
          console.error(`[opencode-studio] ensure-host: parent not reachable at ${parent} (${supervised.reason})`)
          return
        }
        await Bun.sleep(200)
      }
    }
  }

  const ensured = await ensureStudioHostReady({
    parentOpenCodeUrl: parent,
    packageRoot: id.packageRoot,
    studioRoot: id.studioRoot,
    env: id.env,
  })
  if (!ensured.ok) {
    console.error(`[opencode-studio] ensure-host failed: ${ensured.reason}`)
    return
  }
  console.error(`[opencode-studio] Studio host ready: ${ensured.studioUrl} studioRoot=${ensured.studioRoot}`)

  while (true) {
    await Bun.sleep(pollMs)
    if (!(await probeParentOpenCode(parent, id.env))) {
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

  const id = resolveHostIdentity(options)
  if (autostartDisabled(id.env.OPENCODE_STUDIO_AUTOSTART)) return

  const timeoutMs = options?.timeoutMs ?? 45_000
  const started = Date.now()

  void (async () => {
    while (Date.now() - started < timeoutMs) {
      const parent = defaultParentOpenCodeUrl(id.env)
      try {
        if (!(await probeParentOpenCode(parent, id.env))) {
          await Bun.sleep(300)
          continue
        }
        const ensured = await ensureStudioHostReady({
          parentOpenCodeUrl: parent,
          packageRoot: id.packageRoot,
          studioRoot: id.studioRoot,
          env: id.env,
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
      await Bun.sleep(300)
    }
  })()
}
