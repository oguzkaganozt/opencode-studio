import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import envPaths from "env-paths"
import type { StudioId } from "./registry"

export type PackageMeta = {
  name: string
  version: string
  packageRoot: string
  pluginSpecifier: string
  mediaProviderSpecifier: string
}

const packageMetaCache = new Map<string, PackageMeta>()

export async function loadPackageMeta(packageRoot: string): Promise<PackageMeta> {
  const key = path.resolve(packageRoot)
  const cached = packageMetaCache.get(key)
  if (cached) return cached
  const manifestPath = path.join(key, "package.json")
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string; version?: string }
  if (!raw.name || !raw.version) throw new Error(`Invalid package.json at ${manifestPath}`)
  const meta: PackageMeta = {
    name: raw.name,
    version: raw.version,
    packageRoot: key,
    // OpenCode resolves unversioned plugin entries to the current package.
    // Keep versions in status/markers only; pinning here makes `upgrade` stale.
    pluginSpecifier: raw.name,
    mediaProviderSpecifier: `${raw.name}/media-provider`,
  }
  packageMetaCache.set(key, meta)
  return meta
}

export async function skillDigest(skillFile: string) {
  const content = await readFile(skillFile)
  return createHash("sha256").update(content).digest("hex")
}

export function skillSourcePath(packageRoot: string, studioId: StudioId) {
  return path.join(packageRoot, "studios", studioId, "skill", "SKILL.md")
}

export function skillNameFor(studioId: StudioId) {
  return `studio-${studioId}`
}

/** Platform media skill (always managed). Marker studioId stays `media`. */
export const PLATFORM_MEDIA_SKILL_ID = "media" as const

export function platformMediaSkillSourcePath(packageRoot: string) {
  return path.join(packageRoot, "src", "platform", "media", "skill", "SKILL.md")
}

export function platformMediaSkillName() {
  return "studio-media"
}

const FORGE_RUNTIME_FILES = ["pyproject.toml", "uv.lock", "forge_cli.py", ".python-version"] as const

/** Packaged forge sources inside the npm package. */
export function forgeSourceDir(packageRoot: string) {
  return path.join(packageRoot, "studios", "cad", "forge")
}

/** XDG cache directory used as the writable uv project for forge. */
export function forgeRuntimeDir() {
  const paths = envPaths("opencode-studio", { suffix: "" })
  return path.join(paths.cache, "forge")
}

/** Cold `uv sync` budget (separate from design_build's 120s forge build timer). */
export const FORGE_SYNC_TIMEOUT_MS = 600_000

/**
 * Run `uv sync --locked` for a forge project dir. Call before timed `forge build`
 * so dependency install is not killed by the build timeout.
 */
export async function syncForgeUvProject(
  uvPath: string,
  forgeProjectDir: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? FORGE_SYNC_TIMEOUT_MS
  const signal = options?.signal
  if (signal?.aborted) throw new Error("Forge uv sync aborted")

  const child = Bun.spawn([uvPath, "sync", "--locked", "--project", forgeProjectDir], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const timer = setTimeout(() => {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }, timeoutMs)
  const onAbort = () => {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  try {
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (signal?.aborted) throw new Error("Forge uv sync aborted")
    if (code !== 0) {
      throw new Error(`Forge uv sync failed (exit ${code ?? 1}): ${stderr.trim() || "no stderr"}`)
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

/**
 * Sync essential forge project files into the XDG cache and return that path.
 * Keeps uv's venv/writable state out of the installed package tree.
 */
export async function ensureForgeRuntimeDir(packageRoot: string) {
  const source = forgeSourceDir(packageRoot)
  const runtime = forgeRuntimeDir()
  await mkdir(runtime, { recursive: true, mode: 0o700 })

  for (const name of FORGE_RUNTIME_FILES) {
    const from = path.join(source, name)
    const to = path.join(runtime, name)
    let sourceInfo: Awaited<ReturnType<typeof stat>>
    try {
      sourceInfo = await stat(from)
    } catch {
      if (name === ".python-version") continue
      throw new Error(`Missing forge source file: ${from}`)
    }
    let needsCopy = true
    try {
      const destInfo = await stat(to)
      needsCopy = destInfo.mtimeMs < sourceInfo.mtimeMs || destInfo.size !== sourceInfo.size
    } catch {
      needsCopy = true
    }
    if (needsCopy) await copyFile(from, to)
  }

  return runtime
}

/** @deprecated Prefer ensureForgeRuntimeDir; kept as the cache path for callers that already ensure. */
export function forgeProjectDir(_packageRoot?: string) {
  return forgeRuntimeDir()
}

/** Pin for managed build123d MCP; `uv` path is resolved at configure time. */
export const BUILD123D_MCP_PACKAGE = "build123d-mcp@0.3.80"
export const BUILD123D_MCP_PYTHON = "3.12"
export const BUILD123D_MCP_TIMEOUT_MS = 120_000
/** mcp 2.x dropped FastMCP import path that build123d-mcp@0.3.80 still uses. */
export const BUILD123D_MCP_WITH = "mcp>=1.2,<2"

export function build123dMcpEntry(uvPath: string) {
  return {
    type: "local" as const,
    command: [uvPath, "tool", "run", "--python", BUILD123D_MCP_PYTHON, "--with", BUILD123D_MCP_WITH, BUILD123D_MCP_PACKAGE],
    timeout: BUILD123D_MCP_TIMEOUT_MS,
    enabled: true as const,
  }
}

/** @deprecated Prefer build123dMcpEntry(uvPath) so OpenCode can find uv outside PATH. */
export const BUILD123D_MCP = build123dMcpEntry("uv")

export const MANAGED_MCP_KEY = "build123d"
export const MANAGED_MARKER_NAME = ".opencode-studio-managed.json"
/** Legacy filename under OpenCode plugins/ (repair now prefers package dist/media-go.js). */
export const MANAGED_MEDIA_GO_PLUGIN_NAME = "media-go.js"
