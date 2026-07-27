import { existsSync, type FSWatcher, watch } from "node:fs"
import path from "node:path"
import type { StudioLayout } from "./library"
import { ID_PATTERN } from "./manifest"

/**
 * Observation-only Companion events for CAD designs.
 * Rebuilds still belong to agent tools (`design_build`), not the viewer.
 */
export type DesignEvent = {
  type: "designs-changed" | "design-changed"
  designId?: string
  at: number
}

type Listener = (event: DesignEvent) => void

const DEBOUNCE_MS = 400

const listeners = new Set<Listener>()
const rootWatchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function onDesignEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: DesignEvent) {
  for (const listener of listeners) listener(event)
}

function schedule(key: string, event: DesignEvent) {
  const existing = debounceTimers.get(key)
  if (existing) clearTimeout(existing)
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key)
      emit(event)
    }, DEBOUNCE_MS),
  )
}

function designIdFromRelative(filename: string | null | undefined): string | undefined {
  if (!filename) return undefined
  const first = filename.split(/[/\\]/).find(Boolean)
  if (!first || !ID_PATTERN.test(first)) return undefined
  return first
}

/**
 * Start a recursive watcher on designs/. Safe to call repeatedly per root.
 */
export function ensureDesignWatching(layout: StudioLayout): void {
  const root = layout.designsRoot
  if (rootWatchers.has(root)) return
  if (!existsSync(layout.root)) return

  // Ensure designs root exists for watching; missing is fine until first create.
  try {
    if (!existsSync(root)) {
      // Watch parent so designs/ creation is observed.
      const parent = path.dirname(root)
      if (!existsSync(parent) || rootWatchers.has(parent)) return
      const parentWatcher = watch(parent, (eventType, filename) => {
        if (filename !== path.basename(root) && eventType !== "rename") return
        if (existsSync(root) && !rootWatchers.has(root)) {
          parentWatcher.close()
          rootWatchers.delete(parent)
          attachRootWatcher(root)
          schedule(`designs:${root}`, { type: "designs-changed", at: Date.now() })
        }
      })
      rootWatchers.set(parent, parentWatcher)
      return
    }
  } catch {
    return
  }

  attachRootWatcher(root)
}

function attachRootWatcher(root: string) {
  if (rootWatchers.has(root)) return
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      const designId = designIdFromRelative(typeof filename === "string" ? filename : null)
      schedule(`designs:${root}`, { type: "designs-changed", at: Date.now() })
      if (designId) {
        schedule(`design:${root}:${designId}`, { type: "design-changed", designId, at: Date.now() })
      }
    })
  } catch {
    return
  }
  rootWatchers.set(root, watcher)
}
