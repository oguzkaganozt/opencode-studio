import { realpath, stat } from "node:fs/promises"
import path from "node:path"

/**
 * Returns true if `candidate` is inside (or equal to) `root`.
 * Both paths must be absolute and already resolved (no symlinks).
 */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}

/**
 * Resolves and validates the workspace root directory.
 * Throws if the path does not exist or is not a directory.
 */
export async function canonicalWorkspaceRoot(rawPath: string): Promise<string> {
  if (!path.isAbsolute(rawPath)) throw new Error(`workspaceRoot must be an absolute path: ${rawPath}`)
  let resolved: string
  try {
    resolved = await realpath(rawPath)
  } catch {
    throw new Error(`workspaceRoot does not exist: ${rawPath}`)
  }
  const info = await stat(resolved)
  if (!info.isDirectory()) throw new Error(`workspaceRoot is not a directory: ${rawPath}`)
  return resolved
}

/**
 * Safely resolve a workspace-relative or absolute path, confirming confinement.
 * Throws if the resolved path escapes the workspace root.
 */
export async function resolveWorkspacePath(workspaceRoot: string, inputPath: string): Promise<string> {
  const candidate = path.isAbsolute(inputPath) ? inputPath : path.join(workspaceRoot, inputPath)
  const resolved = path.normalize(candidate)
  if (!isInside(workspaceRoot, resolved)) {
    throw new Error(`Path escapes workspace root: ${inputPath}`)
  }
  return resolved
}

/**
 * Validate that `filePath` is a regular file inside the workspace.
 */
export async function assertWorkspaceFile(workspaceRoot: string, filePath: string): Promise<void> {
  const resolved = await resolveWorkspacePath(workspaceRoot, filePath)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(resolved)
  } catch {
    throw new Error(`File not found: ${filePath}`)
  }
  if (!info.isFile()) throw new Error(`Not a regular file: ${filePath}`)
}
