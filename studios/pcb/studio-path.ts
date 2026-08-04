import path from "node:path"
import { canonicalExistingDirectory } from "../../src/core/paths"

export async function canonicalWorkspaceRoot(rawPath: string): Promise<string> {
  if (!path.isAbsolute(rawPath)) throw new Error(`workspaceRoot must be an absolute path: ${rawPath}`)
  try {
    return await canonicalExistingDirectory(rawPath, "workspaceRoot")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("does not exist")) throw new Error(`workspaceRoot does not exist: ${rawPath}`)
    if (message.includes("not a directory")) throw new Error(`workspaceRoot is not a directory: ${rawPath}`)
    throw new Error(message)
  }
}
