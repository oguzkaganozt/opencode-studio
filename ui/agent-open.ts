export const AGENT_OPEN_KEY = "opencode-studio.agentOpen"

export function readAgentOpen(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    const value = storage.getItem(AGENT_OPEN_KEY)
    if (value === null) return false
    return value === "true"
  } catch {
    return false
  }
}

export function writeAgentOpen(open: boolean, storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(AGENT_OPEN_KEY, open ? "true" : "false")
  } catch {
    /* private mode / quota — preference is best-effort */
  }
}
