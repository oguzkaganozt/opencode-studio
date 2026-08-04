import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import envPaths from "env-paths"

export type EngineId = "ffmpeg" | "ffprobe" | "tsci" | "uv"

export type ResolvedEngine = {
  id: EngineId
  /** Absolute path to the executable (or JS entry for tsci). */
  path: string
  source: "bundled" | "path" | "cache"
}

const require = createRequire(import.meta.url)

/** Pin uv download so status/install stay reproducible. */
export const BUNDLED_UV_VERSION = "0.9.26"

function fileOk(candidate: string | null | undefined): candidate is string {
  return Boolean(candidate && existsSync(candidate))
}

export function resolveFfmpeg(): ResolvedEngine | null {
  try {
    const bundled = require("ffmpeg-static") as string | null
    if (fileOk(bundled)) return { id: "ffmpeg", path: bundled, source: "bundled" }
  } catch {
    // optional at typecheck time
  }
  const onPath = Bun.which("ffmpeg")
  if (onPath) return { id: "ffmpeg", path: onPath, source: "path" }
  return null
}

export function resolveFfprobe(): ResolvedEngine | null {
  try {
    const mod = require("ffprobe-static") as { path?: string } | string
    const bundled = typeof mod === "string" ? mod : mod?.path
    if (fileOk(bundled)) return { id: "ffprobe", path: bundled, source: "bundled" }
  } catch {
    // optional at typecheck time
  }
  const onPath = Bun.which("ffprobe")
  if (onPath) return { id: "ffprobe", path: onPath, source: "path" }
  return null
}

/** tscircuit ships `cli.mjs` next to package root (exports block package.json resolve). */
export function resolveTsci(): ResolvedEngine | null {
  try {
    const main = require.resolve("tscircuit")
    const root = path.join(path.dirname(main), "..")
    const cli = path.join(root, "cli.mjs")
    if (fileOk(cli)) return { id: "tsci", path: cli, source: "bundled" }
  } catch {
    // not installed
  }
  const onPath = Bun.which("tsci")
  if (onPath) return { id: "tsci", path: onPath, source: "path" }
  return null
}

function uvCacheDir() {
  return path.join(envPaths("opencode-studio", { suffix: "" }).cache, "bin")
}

export function uvCachePath() {
  const name = process.platform === "win32" ? "uv.exe" : "uv"
  return path.join(uvCacheDir(), name)
}

export function resolveUv(): ResolvedEngine | null {
  const onPath = Bun.which("uv")
  if (onPath) return { id: "uv", path: onPath, source: "path" }
  const cached = uvCachePath()
  if (fileOk(cached)) return { id: "uv", path: cached, source: "cache" }
  return null
}

function uvReleaseAsset(): string {
  const { platform, arch } = process
  if (platform === "linux" && arch === "x64") return "uv-x86_64-unknown-linux-gnu.tar.gz"
  if (platform === "linux" && arch === "arm64") return "uv-aarch64-unknown-linux-gnu.tar.gz"
  if (platform === "darwin" && arch === "x64") return "uv-x86_64-apple-darwin.tar.gz"
  if (platform === "darwin" && arch === "arm64") return "uv-aarch64-apple-darwin.tar.gz"
  if (platform === "win32" && arch === "x64") return "uv-x86_64-pc-windows-msvc.zip"
  if (platform === "win32" && arch === "arm64") return "uv-aarch64-pc-windows-msvc.zip"
  throw new Error(`No bundled uv binary for ${platform}/${arch}`)
}

/** Ensure uv is available: PATH → cache → download official release into XDG cache. */
export async function ensureUv(): Promise<ResolvedEngine> {
  const existing = resolveUv()
  if (existing) return existing

  const asset = uvReleaseAsset()
  const url = `https://github.com/astral-sh/uv/releases/download/${BUNDLED_UV_VERSION}/${asset}`
  const dest = uvCachePath()
  await mkdir(uvCacheDir(), { recursive: true, mode: 0o755 })

  const staging = await mkdtemp(path.join(tmpdir(), "osc-uv-"))
  try {
    const archivePath = path.join(staging, asset)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to download uv ${BUNDLED_UV_VERSION}: HTTP ${response.status}`)
    await Bun.write(archivePath, response)

    if (asset.endsWith(".zip")) {
      const unzip = Bun.spawn(["unzip", "-o", archivePath, "-d", staging], { stdout: "pipe", stderr: "pipe" })
      if ((await unzip.exited) !== 0) throw new Error("Failed to unzip uv archive (unzip required)")
    } else {
      const tar = Bun.spawn(["tar", "-xzf", archivePath, "-C", staging], { stdout: "pipe", stderr: "pipe" })
      if ((await tar.exited) !== 0) throw new Error("Failed to extract uv archive")
    }

    const found = await findFileNamed(staging, process.platform === "win32" ? "uv.exe" : "uv")
    if (!found) throw new Error("uv binary missing from release archive")
    const tmpDest = `${dest}.${process.pid}.tmp`
    await copyFile(found, tmpDest)
    await chmod(tmpDest, 0o755)
    await rename(tmpDest, dest)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  if (!fileOk(dest)) throw new Error(`uv install failed: ${dest} missing`)
  return { id: "uv", path: dest, source: "cache" }
}

export function resolveEngine(id: EngineId): ResolvedEngine | null {
  switch (id) {
    case "ffmpeg":
      return resolveFfmpeg()
    case "ffprobe":
      return resolveFfprobe()
    case "tsci":
      return resolveTsci()
    case "uv":
      return resolveUv()
    default:
      return null
  }
}

/** Command argv prefix to run a resolved engine (tsci is a JS entry). */
export function engineCommand(engine: ResolvedEngine): string[] {
  if (engine.id === "tsci" && engine.path.endsWith(".mjs")) {
    const runtime = Bun.which("bun") ?? process.execPath
    return [runtime, engine.path]
  }
  return [engine.path]
}

async function findFileNamed(root: string, name: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const nested = await findFileNamed(full, name)
      if (nested) return nested
    }
  }
  return null
}
