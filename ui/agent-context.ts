/** Active studio project directory for the Agent panel (does not change Studio Home). */

type Listener = () => void

let currentDirectory: string | undefined
const listeners = new Set<Listener>()

export function getAgentContextDirectory(): string | undefined {
  return currentDirectory
}

export function setAgentContextDirectory(directory: string | undefined): void {
  const next = directory?.trim() || undefined
  if (next === currentDirectory) return
  currentDirectory = next
  for (const listener of listeners) listener()
}

export function subscribeAgentContext(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
