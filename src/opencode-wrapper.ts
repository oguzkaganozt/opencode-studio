import { readFile, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const MARKER = "# opencode-studio ensure-host wrapper"

export function opencodeWrapperPath(home = homedir()): string {
  return path.join(home, ".local", "bin", "opencode")
}

/** Remove PATH wrapper if it is the Studio ensure-host script (marker match). */
export async function removeOpencodeServeWrapper(home = homedir()): Promise<{ path: string; removed: boolean }> {
  const target = opencodeWrapperPath(home)
  try {
    const prev = await readFile(target, "utf8")
    if (!prev.includes(MARKER)) return { path: target, removed: false }
    await unlink(target)
    return { path: target, removed: true }
  } catch {
    return { path: target, removed: false }
  }
}
