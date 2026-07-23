import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"

export { isInside }

export async function canonicalDataRoot(directory: string) {
  const absolute = path.resolve(directory)
  const info = await stat(absolute)
  if (!info.isDirectory()) throw new Error(`Data Root must be an existing directory: ${directory}`)
  return realpath(absolute)
}

export async function readRegularFileInside(root: string, relativePath: string): Promise<Buffer>
export async function readRegularFileInside(root: string, relativePath: string, encoding: BufferEncoding): Promise<string>
export async function readRegularFileInside(root: string, relativePath: string, encoding?: BufferEncoding): Promise<Buffer | string> {
  const candidate = path.resolve(root, relativePath)
  if (!isInside(root, candidate)) throw new Error("Path escapes Data Root")

  const canonicalParent = await realpath(path.dirname(candidate))
  if (!isInside(root, canonicalParent)) throw new Error("Path escapes Data Root")
  const confinedPath = path.join(canonicalParent, path.basename(candidate))
  const handle = await open(confinedPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error("Not a regular file")
    return encoding ? await handle.readFile({ encoding }) : await handle.readFile()
  } finally {
    await handle.close()
  }
}
