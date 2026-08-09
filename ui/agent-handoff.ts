export type AgentHandoffSource = "cad" | "pcb" | "files" | "shell"

export type AgentHandoffRequest = {
  text: string
  source?: AgentHandoffSource
  /** Optional project directory for this one Agent draft. Does not change Studio Home. */
  directory?: string
  /** File paths to attach as composer chips. */
  paths?: string[]
  /** Selection / annotation context (geometry id, net name, etc.). */
  annotation?: string
  /** Open the agent panel if closed. Default true. */
  open?: boolean
  /** Also copy text to clipboard (secondary). Default false. */
  copyFallback?: boolean
}

type Listener = (request: AgentHandoffRequest) => boolean | undefined

const listeners = new Map<Listener, boolean>()
let pending: AgentHandoffRequest | undefined

export function subscribeAgentHandoff(listener: Listener, options?: { consumer?: boolean }): () => void {
  const consumer = Boolean(options?.consumer)
  listeners.set(listener, consumer)
  if (consumer && pending && listener(pending) === true) pending = undefined
  return () => {
    listeners.delete(listener)
  }
}

export function requestAgentHandoff(request: AgentHandoffRequest): void {
  const text = request.text.trim()
  const annotation = request.annotation?.trim()
  const paths = (request.paths ?? []).map((p) => p.trim()).filter(Boolean)
  if (!text && !annotation && paths.length === 0) return

  const normalized: AgentHandoffRequest = {
    ...request,
    text,
    annotation,
    paths: paths.length ? paths : undefined,
    open: request.open !== false,
    copyFallback: Boolean(request.copyFallback),
  }

  let handled = false
  for (const [listener, consumer] of listeners) {
    if (listener(normalized) === true && consumer) handled = true
  }
  if (!handled) pending = normalized

  const clipboard = text || annotation || paths.join("\n")
  if (!handled && normalized.copyFallback && clipboard && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(clipboard).catch(() => {})
  }
}

export function resetAgentHandoffForTests() {
  listeners.clear()
  pending = undefined
}
