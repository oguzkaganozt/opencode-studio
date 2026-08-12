import type { AgentHandoffRequest } from "@ui/agent-handoff"

export type MediaModality = "image" | "video" | "audio"

export type MediaBBox = { x: number; y: number; w: number; h: number }

export type MediaSelection = {
  modality: MediaModality
  path: string
  /** Image pixel bbox in source image coordinates. */
  spatial?: MediaBBox
  /** Inclusive-exclusive time range in seconds. */
  temporal?: { start: number; end: number }
  summary: string
}

export function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0.00"
  return value.toFixed(2)
}

export function selectionSummary(selection: Omit<MediaSelection, "summary">): string {
  if (selection.spatial) {
    const { x, y, w, h } = selection.spatial
    return `${selection.modality} · bbox ${Math.round(x)},${Math.round(y)} ${Math.round(w)}×${Math.round(h)}`
  }
  if (selection.temporal) {
    return `${selection.modality} · ${formatSeconds(selection.temporal.start)}s–${formatSeconds(selection.temporal.end)}s`
  }
  return `${selection.modality} · ${selection.path}`
}

export function createMediaSelection(input: Omit<MediaSelection, "summary">): MediaSelection | null {
  if (!input.path.trim()) return null
  if (input.spatial) {
    const { x, y, w, h } = input.spatial
    if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) return null
  }
  if (input.temporal) {
    const { start, end } = input.temporal
    if (![start, end].every(Number.isFinite) || start < 0 || end <= start) return null
  }
  const base = {
    modality: input.modality,
    path: input.path.trim(),
    spatial: input.spatial
      ? {
          x: Math.max(0, Math.round(input.spatial.x)),
          y: Math.max(0, Math.round(input.spatial.y)),
          w: Math.max(1, Math.round(input.spatial.w)),
          h: Math.max(1, Math.round(input.spatial.h)),
        }
      : undefined,
    temporal: input.temporal
      ? { start: Number(input.temporal.start.toFixed(3)), end: Number(input.temporal.end.toFixed(3)) }
      : undefined,
  }
  return { ...base, summary: selectionSummary(base) }
}

export function mediaSelectionAnnotation(selection: MediaSelection): string {
  const lines = [
    `Media selection (${selection.modality})`,
    `path=${selection.path}`,
    selection.spatial
      ? `bbox_px=x=${selection.spatial.x} y=${selection.spatial.y} w=${selection.spatial.w} h=${selection.spatial.h}`
      : undefined,
    selection.temporal
      ? `time_s=start=${formatSeconds(selection.temporal.start)} end=${formatSeconds(selection.temporal.end)}`
      : undefined,
  ]
  return lines.filter(Boolean).join("\n")
}

export function createMediaSelectionHandoff(
  directory: string,
  selection: MediaSelection,
  text?: string,
): AgentHandoffRequest {
  const defaultText =
    selection.modality === "image" && selection.spatial
      ? `Edit the selected image region on ${selection.path} (bbox ${selection.spatial.x},${selection.spatial.y} ${selection.spatial.w}×${selection.spatial.h}). Prefer media_image_crop and/or media_image_edit.`
      : selection.modality === "video" && selection.temporal
        ? `Trim ${selection.path} from ${formatSeconds(selection.temporal.start)}s to ${formatSeconds(selection.temporal.end)}s with media_trim.`
        : selection.modality === "audio" && selection.temporal
          ? `Trim audio ${selection.path} from ${formatSeconds(selection.temporal.start)}s to ${formatSeconds(selection.temporal.end)}s with media_trim.`
          : `Inspect media asset ${selection.path}.`

  return {
    text: (text ?? defaultText).trim(),
    source: "media",
    directory,
    paths: [selection.path],
    annotation: mediaSelectionAnnotation(selection),
    open: true,
    copyFallback: true,
  }
}
