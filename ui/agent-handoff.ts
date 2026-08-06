export type AgentHandoffSource = "cad" | "pcb" | "files" | "shell"

export type AgentHandoffRequest = {
  text: string
  source?: AgentHandoffSource
  /** Optional project directory for this one Agent draft. Does not change Studio Home. */
  directory?: string
  /** Open the agent panel if closed. Default true. */
  open?: boolean
  /** Also copy text to clipboard (secondary). Default false. */
  copyFallback?: boolean
}

type Listener = (request: AgentHandoffRequest) => void

const listeners = new Set<Listener>()

export function subscribeAgentHandoff(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function requestAgentHandoff(request: AgentHandoffRequest): void {
  const text = request.text.trim()
  if (!text) return

  const normalized: AgentHandoffRequest = {
    ...request,
    text,
    open: request.open !== false,
    copyFallback: Boolean(request.copyFallback),
  }

  if (normalized.copyFallback && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {})
  }

  for (const listener of listeners) listener(normalized)
}
