import { randomUUID } from "node:crypto"
import { constants, type Stats } from "node:fs"
import { lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { StudioError } from "./errors"

export function isInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function contained(root: string, candidate: string, allowRoot: boolean) {
  const base = path.resolve(root)
  const target = path.resolve(candidate)
  return isInside(base, target) || (allowRoot && base === target)
}

/** Lexical resolve of input under root (absolute or relative). */
export function resolveUnderRoot(root: string, input: string, options?: { allowRoot?: boolean }) {
  const resolvedRoot = path.resolve(root)
  const candidate = path.isAbsolute(input) ? path.normalize(input) : path.resolve(resolvedRoot, input)
  if (!contained(resolvedRoot, candidate, options?.allowRoot === true)) {
    throw new StudioError("path_escape", "Path escapes root")
  }
  return candidate
}

export type ContainedPath = {
  absolute: string
  relative: string
  info: Stats
}

export type ResolveContainedOptions = {
  /** Reject when the path itself is a symlink (default true). */
  rejectSymlink?: boolean
  kind?: "file" | "directory" | "any"
  /**
   * Documented for call-site intent. `isInside` already treats root equality as
   * inside (`relative === ""`), so this flag does not change lexical acceptance.
   */
  allowRoot?: boolean
  /** Compare final path against realpath(root) (default false). */
  realpathRoot?: boolean
}

/**
 * Resolve an existing path that must stay inside root after realpath.
 * Shared SoT for host file serving and media path checks.
 */
export async function resolveContainedPath(root: string, candidate: string, options?: ResolveContainedOptions): Promise<ContainedPath> {
  const rejectSymlink = options?.rejectSymlink !== false
  const kind = options?.kind ?? "any"
  const allowRoot = options?.allowRoot === true
  const resolvedRoot = path.resolve(root)
  const abs = path.resolve(candidate)

  if (!contained(resolvedRoot, abs, allowRoot)) {
    throw new StudioError("path_escape", "Path escapes root")
  }

  let linkInfo: Stats
  try {
    linkInfo = await lstat(abs)
  } catch {
    throw new StudioError("not_found", "File not found")
  }

  if (rejectSymlink && linkInfo.isSymbolicLink()) {
    throw new StudioError("symlink_rejected", "Symlinks are not allowed")
  }

  if (rejectSymlink) {
    if (kind === "file" && !linkInfo.isFile()) throw new StudioError("not_file", "Not a regular file")
    if (kind === "directory" && !linkInfo.isDirectory()) throw new StudioError("not_directory", "Not a directory")
  }

  let absolute: string
  let baseRoot = resolvedRoot
  try {
    absolute = await realpath(abs)
    if (options?.realpathRoot) baseRoot = await realpath(resolvedRoot)
  } catch {
    throw new StudioError("not_found", "File not found")
  }

  if (!contained(baseRoot, absolute, allowRoot)) {
    throw new StudioError("path_resolves_outside", "Path resolves outside root")
  }

  let info = linkInfo
  if (!rejectSymlink) {
    try {
      info = await lstat(absolute)
    } catch {
      throw new StudioError("not_found", "File not found")
    }
    if (kind === "file" && !info.isFile()) throw new StudioError("not_file", "Not a regular file")
    if (kind === "directory" && !info.isDirectory()) throw new StudioError("not_directory", "Not a directory")
  }

  return {
    absolute,
    relative: path.relative(baseRoot, absolute).split(path.sep).join("/"),
    info,
  }
}

export async function resolveWorkspace(explicit?: string, cwd = process.cwd()) {
  const requested = explicit && explicit.length > 0 ? explicit : cwd
  if (!requested || requested.includes("\0")) {
    throw new StudioError("invalid_workspace", "Workspace path is required")
  }
  const absolute = path.resolve(requested)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(absolute)
  } catch {
    throw new StudioError("invalid_workspace", `Workspace does not exist: ${absolute}`)
  }
  if (!info.isDirectory()) {
    throw new StudioError("invalid_workspace", `Workspace is not a directory: ${absolute}`)
  }
  return await realpath(absolute)
}

export async function canonicalExistingDirectory(dir: string, label = "directory") {
  if (!dir || dir.includes("\0")) throw new StudioError("invalid_path", `${label} must be a non-empty path`)
  const absolute = path.resolve(dir)
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(absolute)
  } catch {
    throw new StudioError("invalid_path", `${label} does not exist: ${absolute}`)
  }
  if (info.isSymbolicLink()) {
    const target = await realpath(absolute)
    const targetInfo = await stat(target)
    if (!targetInfo.isDirectory()) throw new StudioError("invalid_path", `${label} is not a directory: ${absolute}`)
    return target
  }
  if (!info.isDirectory()) throw new StudioError("invalid_path", `${label} is not a directory: ${absolute}`)
  return await realpath(absolute)
}

export async function ensureDirectory(dir: string, mode = 0o700) {
  const absolute = path.resolve(dir)
  await mkdir(absolute, { recursive: true, mode })
  return await realpath(absolute)
}

async function readOpenRegularFile(candidate: string) {
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new StudioError("not_file", "Not a regular file")
    const buffer = Buffer.alloc(info.size)
    await handle.read(buffer, 0, info.size, 0)
    return buffer
  } finally {
    await handle.close()
  }
}

/** Read an absolute path that must stay a regular, non-symlink file inside root. */
export async function readRegularFileAt(root: string, absolutePath: string) {
  const { absolute } = await resolveContainedPath(root, absolutePath, { kind: "file", rejectSymlink: true })
  return readOpenRegularFile(absolute)
}

export function packageRootFrom(importMetaDir: string) {
  const dir = path.resolve(importMetaDir)
  if (path.basename(dir) === "dist" || path.basename(dir) === "src") return path.dirname(dir)
  if (path.basename(path.dirname(dir)) === "core") return path.resolve(dir, "../..")
  return dir
}

/** Write JSON via temp file + fsync + rename. Target must stay inside root when root is set. */
export async function atomicWriteJson(targetPath: string, value: unknown, opts?: { root?: string; mode?: number }) {
  const target = path.resolve(targetPath)
  if (opts?.root && !isInside(opts.root, target)) {
    throw new StudioError("path_escape", "Path escapes root")
  }
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  const mode = opts?.mode ?? 0o644
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode)
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
