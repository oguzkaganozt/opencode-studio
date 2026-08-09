import { useEffect } from "react"
import { subscribeAgentFileEvents } from "./agent-file-events"

/** Call onInvalidate when the agent edits a path under prefix (or any path if prefix empty). */
export function useViewerRefresh(prefix: string | undefined, onInvalidate: () => void) {
  useEffect(() => {
    const root = prefix?.trim()
    return subscribeAgentFileEvents((event) => {
      if (!event.paths.length) return
      if (!root) {
        onInvalidate()
        return
      }
      const hit = event.paths.some((p) => p === root || p.startsWith(`${root}/`))
      if (hit) onInvalidate()
    })
  }, [prefix, onInvalidate])
}
