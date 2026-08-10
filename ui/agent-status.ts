export type AgentStatus = "closed" | "loading" | "ready" | "unavailable" | "error"

export type AgentStatusInput = {
  open: boolean
  available: boolean
  loading: boolean
  error: boolean
}

export function deriveAgentStatus(input: AgentStatusInput): AgentStatus {
  if (!input.open) return "closed"
  if (!input.available) return "unavailable"
  if (input.error) return "error"
  if (input.loading) return "loading"
  return "ready"
}

export function agentStatusDotClass(status: AgentStatus): string {
  switch (status) {
    case "closed":
      return "bg-[var(--osc-text-faint)]"
    case "loading":
      return "bg-[var(--osc-text-muted)]"
    case "ready":
      return "bg-[var(--osc-success)]"
    case "unavailable":
      return "bg-[var(--osc-warning)]"
    case "error":
      return "bg-[var(--osc-error)]"
  }
}

/** Tone token for the header status dot (busy/reconnect override readiness). */
export function agentStatusDotTone(status: AgentStatus, busy = false, reconnecting = false): AgentStatus | "busy" {
  if (reconnecting && status !== "unavailable" && status !== "error" && status !== "closed") return "loading"
  if (busy && (status === "ready" || status === "loading")) return "busy"
  return status
}

export function agentStatusLabel(status: AgentStatus): string {
  switch (status) {
    case "closed":
      return "Agent closed"
    case "loading":
      return "Agent loading"
    case "ready":
      return "Agent ready"
    case "unavailable":
      return "Agent unavailable"
    case "error":
      return "Agent error"
  }
}

/** Header status-dot tooltip / accessible name (busy/reconnect override readiness). */
export function agentStatusDotLabel(status: AgentStatus, busy = false, reconnecting = false): string {
  if (reconnecting && status !== "unavailable" && status !== "error" && status !== "closed") return "Reconnecting…"
  if (busy && (status === "ready" || status === "loading")) return "Working"
  return agentStatusLabel(status)
}

export function agentStatusDotPulse(status: AgentStatus, busy = false, reconnecting = false): boolean {
  return busy || status === "loading" || reconnecting
}
