import { useEffect } from "react"
import { subscribeAgentFileEvents } from "./agent-file-events"

export function normalizeAgentFilePath(path: string, directory?: string): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || !directory?.trim()) return normalized
  const root = directory.trim().replaceAll("\\", "/").replace(/\/+$/, "")
  return `${root}/${normalized}`
}

/** Call onInvalidate when the agent edits a path under prefix (or any path if prefix empty). */
export function useViewerRefresh(prefix: string | undefined, onInvalidate: () => void) {
  useEffect(() => {
    const root = prefix?.trim().replaceAll("\\", "/").replace(/\/+$/, "")
    return subscribeAgentFileEvents((event) => {
      if (!event.paths.length) return
      if (!root) {
        onInvalidate()
        return
      }
      const hit = event.paths.some((path) => {
        const normalized = normalizeAgentFilePath(path, event.directory)
        return normalized === root || normalized.startsWith(`${root}/`)
      })
      if (hit) onInvalidate()
    })
  }, [prefix, onInvalidate])
}
