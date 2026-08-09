/** Lightweight bus: agent touched files → studio viewers can invalidate. */

export type AgentFileEvent = {
  paths: string[]
  sessionID?: string
}

type Listener = (event: AgentFileEvent) => void

const listeners = new Set<Listener>()

export function subscribeAgentFileEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishAgentFileEvent(event: AgentFileEvent): void {
  if (!event.paths.length) return
  for (const listener of listeners) listener(event)
}
