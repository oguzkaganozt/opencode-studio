import path from "node:path"
import { packageRootFrom } from "./core/paths"
import { ensureStudioHost, probeParentOpenCode, rebindStudioHostWorkspace } from "./host-ensure"
import { openCodeBasicAuthHeaders } from "./opencode-bridge"

const g = globalThis as typeof globalThis & { __opencodeStudioBootstrap?: boolean }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function defaultWorkspace(env: NodeJS.ProcessEnv = process.env): string {
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

async function fetchLatestSessionDirectory(parentUrl: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const headers = new Headers(openCodeBasicAuthHeaders(env))
    const response = await fetch(new URL("/session", `${parentUrl.replace(/\/$/, "")}/`), {
      headers,
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return undefined
    const sessions = (await response.json()) as Array<{ directory?: string; time?: { updated?: number } }>
    if (!Array.isArray(sessions) || sessions.length === 0) return undefined
    const ranked = sessions
      .filter((s) => typeof s.directory === "string" && path.isAbsolute(s.directory))
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    const dir = ranked[0]?.directory
    return dir ? path.resolve(dir) : undefined
  } catch {
    return undefined
  }
}

/**
 * Start Studio host as soon as parent OpenCode is reachable — default workspace HOME.
 * Optionally poll sessions and rebind to the latest active project directory.
 */
export async function runEnsureHostLoop(options?: {
  packageRoot?: string
  env?: NodeJS.ProcessEnv
  /** Exit when parent dies (default true for CLI ensure-host). */
  exitWhenParentDown?: boolean
  pollMs?: number
}): Promise<void> {
  const env = options?.env ?? process.env
  if (env.OPENCODE_STUDIO_AUTOSTART === "0" || env.OPENCODE_STUDIO_AUTOSTART === "false") {
    console.error("[opencode-studio] ensure-host skipped (AUTOSTART disabled)")
    return
  }

  const packageRoot = options?.packageRoot ?? packageRootFrom(import.meta.dir)
  const pollMs = options?.pollMs ?? 2_000
  const exitWhenParentDown = options?.exitWhenParentDown !== false
  const parent = defaultParentOpenCodeUrl(env)
  const workspace = defaultWorkspace(env)

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
    workspace,
    packageRoot,
    env,
  })
  if (!ensured.ok) {
    console.error(`[opencode-studio] ensure-host failed: ${ensured.reason}`)
    return
  }
  console.error(`[opencode-studio] Studio host ready: ${ensured.studioUrl} workspace=${ensured.workspace}`)

  // Keep process alive; rebind when OpenCode sessions change.
  while (true) {
    await sleep(pollMs)
    if (!(await probeParentOpenCode(parent, env))) {
      if (exitWhenParentDown) {
        console.error("[opencode-studio] parent OpenCode gone; ensure-host exiting")
        return
      }
      continue
    }
    const latest = await fetchLatestSessionDirectory(parent, env)
    if (latest) {
      try {
        await rebindStudioHostWorkspace(latest)
      } catch {
        // ignore transient
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
  if (env.OPENCODE_STUDIO_AUTOSTART === "0" || env.OPENCODE_STUDIO_AUTOSTART === "false") return

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
        const workspace = defaultWorkspace(env)
        const ensured = await ensureStudioHost({
          parentOpenCodeUrl: parent,
          workspace,
          packageRoot,
          env,
        })
        if (ensured.ok) {
          if (!ensured.reused) {
            console.error(`[opencode-studio] Studio host ready (bootstrap): ${ensured.studioUrl} workspace=${ensured.workspace}`)
          }
          return
        }
        if (/not owned|PASSWORD|AUTOSTART/i.test(ensured.reason)) {
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

export function resetServeBootstrapForTests() {
  g.__opencodeStudioBootstrap = false
}
