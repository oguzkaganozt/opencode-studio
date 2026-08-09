import type { Part } from "@opencode-ai/sdk/client"

export function textFromParts(parts: Part[]): string {
  return parts
    .filter((p): p is Part & { type: "text"; text: string } => p.type === "text" && typeof (p as { text?: string }).text === "string")
    .map((p) => p.text)
    .join("\n\n")
    .trim()
}

export function summarizePart(part: Part): string | undefined {
  if (part.type === "text") return textFromParts([part]).slice(0, 120) || "text"
  if (part.type === "tool") return toolLabel(part) ?? "tool"
  if (part.type === "reasoning") return "thinking…"
  if (part.type === "file") return `file ${(part as { filename?: string }).filename ?? ""}`.trim()
  if (part.type === "retry") return "retrying…"
  if (part.type === "patch") {
    const count = (part as { files?: string[] }).files?.length ?? 0
    return count ? `${count} ${count === 1 ? "file" : "files"} updated` : undefined
  }
  if (part.type === "subtask") return (part as { description?: string }).description || "subtask"
  return undefined
}

export function toolLabel(part: Part): string | undefined {
  if (part.type !== "tool") return undefined
  const tool = part as { tool?: string; state?: { status?: string } }
  return tool.tool || "tool"
}

export function toolStatus(part: Part): string | undefined {
  if (part.type !== "tool") return undefined
  const status = (part as { state?: { status?: string } }).state?.status
  return status
}

/** Short inline preview for a collapsed tool row (command, path, pattern, …). */
export function toolPreview(part: Part): string | undefined {
  if (part.type !== "tool") return undefined
  const tool = String((part as { tool?: string }).tool ?? "")
  const input = (part as { state?: { input?: unknown } }).state?.input
  if (!input || typeof input !== "object") return undefined
  const record = input as Record<string, unknown>
  const firstLine = (value: unknown) => (typeof value === "string" ? value.split("\n")[0] : undefined)
  let raw: string | undefined
  switch (tool) {
    case "bash":
      raw = firstLine(record.command)
      break
    case "read":
    case "edit":
    case "write":
      raw = firstLine(record.filePath)
      break
    case "glob":
    case "grep":
      raw = firstLine(record.pattern)
      break
    case "task":
      raw = firstLine(record.description)
      break
    case "webfetch":
      raw = firstLine(record.url)
      break
    case "websearch":
      raw = firstLine(record.query)
      break
    default:
      raw = undefined
  }
  const preview = raw?.trim()
  if (!preview) return undefined
  return preview.length > 72 ? `${preview.slice(0, 72)}…` : preview
}

export function toolDetail(part: Part): string | undefined {
  if (part.type !== "tool") return undefined
  const state = (part as { state?: Record<string, unknown> }).state
  if (!state) return undefined
  const bits: string[] = []
  if (typeof state.input === "object" && state.input) {
    try {
      bits.push(JSON.stringify(state.input, null, 2))
    } catch {
      // ignore
    }
  }
  if (typeof state.output === "string" && state.output.trim()) {
    bits.push(state.output.trim().slice(0, 4_000))
  } else if (state.output != null) {
    try {
      bits.push(JSON.stringify(state.output, null, 2).slice(0, 4_000))
    } catch {
      // ignore
    }
  }
  if (typeof state.error === "string") bits.push(`error: ${state.error}`)
  return bits.join("\n\n") || undefined
}
