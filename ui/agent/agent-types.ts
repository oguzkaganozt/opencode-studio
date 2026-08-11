import type { Session } from "@opencode-ai/sdk/v2/client"
import type { StudioSessionContext, StudioSessionHistoryItem } from "../../src/core/session-history"
import type { AgentContext } from "../agent-context"
import type { AgentHandoffRequest } from "../agent-handoff"
import type { AgentMessage } from "./client"

export type ModelPreference = { providerID: string; modelID: string }
export type ModelRef = ModelPreference & { variants: string[] }
export type AgentPrefs = { model?: ModelPreference; variants?: Record<string, string> }

export type ComposerChip = {
  id: string
  kind: "path" | "annotation"
  value: string
  label: string
}

export type ComposerState = {
  draft: string
  chips: ComposerChip[]
}

export type PendingSession = { id: string; directory: string }

export type PopoverKind = "session" | "model" | "variant" | null

export const MODEL_UI_LIMIT = 80

export function checkingContext(): AgentContext {
  return { key: "route", kind: "home", label: "Loading context…", status: "checking" }
}

export function contextMetadata(context: AgentContext): StudioSessionContext {
  if (!context.directory) throw new Error("Agent context directory is unavailable")
  return {
    schema: 1,
    key: context.key,
    kind: context.kind,
    label: context.label,
    studioId: context.studioId,
    projectId: context.projectId,
    relativePath: context.relativePath,
    directory: context.directory,
    historicalDirectory: context.historicalDirectory ?? context.directory,
    status: context.status === "checking" ? "missing" : context.status,
  }
}

export function contextLink(context: AgentContext): { href: string; label: string } | undefined {
  if (!context.projectId) return undefined
  const id = encodeURIComponent(context.projectId)
  if (context.kind === "cad-project") return { href: `/studios/cad/designs/${id}`, label: "Open design" }
  if (context.kind === "pcb-project") return { href: `/studios/pcb/projects/${id}/schematic`, label: "Open project" }
  if (context.kind === "media-project") return { href: `/studios/media/projects/${id}`, label: "Open project" }
  return undefined
}

export function sameContext(left: AgentContext, right: AgentContext): boolean {
  return (
    left.key === right.key &&
    left.directory === right.directory &&
    left.historicalDirectory === right.historicalDirectory &&
    left.kind === right.kind &&
    left.studioId === right.studioId &&
    left.projectId === right.projectId &&
    left.label === right.label &&
    left.relativePath === right.relativePath &&
    left.status === right.status
  )
}

export function handoffChips(handoff: AgentHandoffRequest): ComposerChip[] {
  const chips: ComposerChip[] = []
  for (const value of handoff.paths ?? []) {
    chips.push({ id: `path:${value}`, kind: "path", value, label: value.split("/").pop() || value })
  }
  if (handoff.annotation?.trim()) {
    const value = handoff.annotation.trim()
    chips.push({
      id: `ann:${value.slice(0, 48)}`,
      kind: "annotation",
      value,
      label: value.length > 36 ? `${value.slice(0, 36)}…` : value,
    })
  }
  return chips
}

export function historyItem(session: Session, context: AgentContext): StudioSessionHistoryItem {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    parentID: session.parentID,
    model: session.model,
    time: session.time,
    context: contextMetadata(context),
  }
}

export function composerKey(contextKey: string, directory: string, sessionID?: string): string {
  return `${contextKey}\0${directory}\0${sessionID ?? "new"}`
}

export function prefsKey(directory: string) {
  return `osc-agent-prefs:${directory}`
}

export function readPrefs(directory: string): AgentPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(directory))
    if (!raw) return {}
    return JSON.parse(raw) as AgentPrefs
  } catch {
    return {}
  }
}

export function writePrefs(directory: string, prefs: AgentPrefs) {
  try {
    localStorage.setItem(prefsKey(directory), JSON.stringify(prefs))
  } catch {
    // ignore
  }
}

export function modelKey(model: ModelRef) {
  return `${model.providerID}/${model.modelID}`
}

export function roleOf(info: AgentMessage["info"]): "user" | "assistant" | "other" {
  const role = "role" in info ? String(info.role) : ""
  if (role === "user") return "user"
  if (role === "assistant") return "assistant"
  return "other"
}

export function composeOutbound(chips: ComposerChip[], draft: string): string {
  const pieces: string[] = []
  for (const chip of chips) {
    if (chip.kind === "path") pieces.push(`@${chip.value}`)
    else pieces.push(chip.value)
  }
  if (draft.trim()) pieces.push(draft.trim())
  return pieces.join("\n\n")
}
