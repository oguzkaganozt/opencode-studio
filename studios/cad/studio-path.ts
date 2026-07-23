import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"

export { isInside }

export async function canonicalRoot(directory: string) {
  return realpath(directory)
}

export function resolveInside(root: string, input: string) {
  const candidate = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input)
  if (!isInside(root, candidate)) throw new Error(`Path must be inside the studio root: ${input}`)
  return candidate
}

export async function validateDesignId(id: string) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid design id: ${id}`)
  return id
}

export async function safeResolve(root: string, input: string) {
  const candidate = resolveInside(root, input)
  try {
    const canonical = await realpath(candidate)
    if (!isInside(root, canonical)) throw new Error(`Path resolves outside the studio root: ${input}`)
    return canonical
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const parent = path.dirname(candidate)
      const canonicalParent = await realpath(parent)
      if (!isInside(root, canonicalParent)) throw new Error(`Path resolves outside the studio root: ${input}`)
      return path.join(canonicalParent, path.basename(candidate))
    }
    throw error
  }
}

export async function assertRegularFile(filePath: string) {
  const info = await lstat(filePath)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Not a regular file: ${filePath}`)
  const canonical = await realpath(filePath)
  return canonical
}
