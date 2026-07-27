export type AgentStatus = "closed" | "loading" | "ready" | "needs-password" | "setup" | "error"

export type AgentStatusInput = {
  open: boolean
  /** Sessions list has not settled yet */
  sessionsPending: boolean
  queryError?: { status?: number; code?: string } | null
}

export function deriveAgentStatus(input: AgentStatusInput): AgentStatus {
  if (!input.open) return "closed"

  const error = input.queryError
  if (error) {
    if (error.status === 401) return "needs-password"
    if (error.code === "chat_auth_required") return "setup"
    return "error"
  }

  if (input.sessionsPending) return "loading"
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
    case "needs-password":
    case "setup":
      return "bg-[var(--osc-warning)]"
    case "error":
      return "bg-[var(--osc-error)]"
  }
}

export function agentStatusLabel(status: AgentStatus): string {
  switch (status) {
    case "closed":
      return "Agent closed"
    case "loading":
      return "Agent loading"
    case "ready":
      return "Agent ready"
    case "needs-password":
      return "Agent needs password"
    case "setup":
      return "Agent setup required"
    case "error":
      return "Agent error"
  }
}
