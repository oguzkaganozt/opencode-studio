import { existsSync, type FSWatcher, watch } from "node:fs"
import { listConcepts } from "./workspace"

export type ConceptEvent = {
  type: "concepts-changed" | "artifacts-changed"
  conceptId?: string
  at: number
}

type Listener = (event: ConceptEvent) => void

const DEBOUNCE_MS = 400
const listeners = new Set<Listener>()
const watchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function onConceptEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: ConceptEvent) {
  for (const listener of listeners) listener(event)
}

function schedule(key: string, event: ConceptEvent) {
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

function dropWatcher(key: string) {
  const watcher = watchers.get(key)
  if (!watcher) return
  try {
    watcher.close()
  } catch {
    // already closed
  }
  watchers.delete(key)
}

function watchPath(key: string, directory: string, filter: (filename: string | null) => boolean, onMatch: () => void) {
  if (watchers.has(key)) return
  if (!existsSync(directory)) return
  let watcher: FSWatcher
  try {
    watcher = watch(directory, (_eventType, filename) => {
      if (!filter(filename)) return
      onMatch()
    })
  } catch {
    return
  }
  watcher.on("error", () => dropWatcher(key))
  if (typeof (watcher as { unref?: () => void }).unref === "function") {
    ;(watcher as { unref: () => void }).unref()
  }
  watchers.set(key, watcher)
}

export function closeAllConceptWatchers() {
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  for (const key of [...watchers.keys()]) dropWatcher(key)
  listeners.clear()
}

export async function ensureConceptWatching(root: string) {
  watchPath(
    "workspace",
    root,
    (filename) => Boolean(filename),
    () => {
      schedule("workspace", { type: "concepts-changed", at: Date.now() })
      void refreshProjectWatchers(root)
    },
  )
  await refreshProjectWatchers(root)
}

async function refreshProjectWatchers(root: string) {
  const concepts = await listConcepts(root).catch(() => [])
  const live = new Set(concepts.map((item) => item.id))
  for (const key of [...watchers.keys()]) {
    if (key.startsWith("concept:") && !live.has(key.slice("concept:".length))) dropWatcher(key)
  }
  for (const entry of concepts) {
    const key = `concept:${entry.id}`
    watchPath(
      key,
      entry.directory,
      (filename) => {
        const name = filename ?? ""
        return name === "concept.json" || name === "review.json" || name === "BRIEF.md" || name === "moodboards"
      },
      () => {
        schedule(key, { type: "artifacts-changed", conceptId: entry.id, at: Date.now() })
      },
    )
  }
}
