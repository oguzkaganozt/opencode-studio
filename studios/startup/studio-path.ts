import path from "node:path"
import { canonicalExistingDirectory, readRegularFileInside as coreReadRegularFileInside, isInside } from "../../src/core/paths"

export { isInside }

export async function canonicalDataRoot(directory: string) {
  return canonicalExistingDirectory(directory, "Data Root")
}

export async function readRegularFileInside(root: string, relativePath: string): Promise<Buffer>
export async function readRegularFileInside(root: string, relativePath: string, encoding: BufferEncoding): Promise<string>
export async function readRegularFileInside(root: string, relativePath: string, encoding?: BufferEncoding): Promise<Buffer | string> {
  try {
    const buffer = await coreReadRegularFileInside(root, relativePath)
    return encoding ? buffer.toString(encoding) : buffer
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("escapes")) throw new Error("Path escapes Data Root")
    if (message.includes("Not a regular file") || message.includes("not_file")) throw new Error("Not a regular file")
    throw error
  }
}

export function resolveDataPath(root: string, relativePath: string) {
  const candidate = path.resolve(root, relativePath)
  if (!isInside(root, candidate)) throw new Error("Path escapes Data Root")
  return candidate
}
