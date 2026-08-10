import type { StudioSessionContextKind, StudioSessionContextStatus } from "../src/core/session-history"

export type AgentContext = {
  key: string
  kind: StudioSessionContextKind
  label: string
  directory?: string
  historicalDirectory?: string
  studioId?: "cad" | "pcb"
  projectId?: string
  relativePath?: string
  status: StudioSessionContextStatus | "checking"
}

type Listener = () => void

let currentClaim: { owner: string; token: symbol; context: AgentContext } | undefined
const listeners = new Set<Listener>()

function notify() {
  for (const listener of listeners) listener()
}

export function getAgentContext(): AgentContext | undefined {
  return currentClaim?.context
}

export function claimAgentContext(owner: string, context: AgentContext): () => void {
  const token = Symbol(owner)
  currentClaim = { owner, token, context }
  notify()
  return () => {
    queueMicrotask(() => {
      if (currentClaim?.token !== token) return
      currentClaim = undefined
      notify()
    })
  }
}

export function subscribeAgentContext(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function homeAgentContext(directory: string): AgentContext {
  return {
    key: "home",
    kind: "home",
    label: "Home",
    directory,
    historicalDirectory: directory,
    status: "available",
  }
}
