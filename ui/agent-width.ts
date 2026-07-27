export const AGENT_WIDTH_KEY = "opencode-studio.agentWidth"
export const AGENT_WIDTH_DEFAULT = 420
export const AGENT_WIDTH_MIN = 280
export const AGENT_WIDTH_MAX = 720

export function viewportAgentWidthMax(viewportWidth = typeof window !== "undefined" ? window.innerWidth : AGENT_WIDTH_MAX): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return AGENT_WIDTH_MAX
  return Math.min(AGENT_WIDTH_MAX, Math.max(AGENT_WIDTH_MIN, Math.round(viewportWidth * 0.9)))
}

export function clampAgentWidth(value: number, viewportWidth?: number): number {
  if (!Number.isFinite(value)) return AGENT_WIDTH_DEFAULT
  const max = viewportWidth === undefined ? AGENT_WIDTH_MAX : viewportAgentWidthMax(viewportWidth)
  return Math.min(max, Math.max(AGENT_WIDTH_MIN, Math.round(value)))
}

export function readAgentWidth(storage: Pick<Storage, "getItem"> = localStorage): number {
  try {
    const raw = storage.getItem(AGENT_WIDTH_KEY)
    if (raw === null) return AGENT_WIDTH_DEFAULT
    return clampAgentWidth(Number(raw))
  } catch {
    return AGENT_WIDTH_DEFAULT
  }
}

export function writeAgentWidth(width: number, storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(AGENT_WIDTH_KEY, String(clampAgentWidth(width)))
  } catch {
    /* private mode / quota — preference is best-effort */
  }
}
