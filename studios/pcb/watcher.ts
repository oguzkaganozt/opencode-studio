import { existsSync, type FSWatcher, watch } from "node:fs"
import path from "node:path"
import { type CircuitProjectDescriptor, discoverProjectDescriptors } from "./workspace"

/**
 * Observation-only Companion events. Rebuild orchestration belongs to agent
 * tools (`pcb_circuit_build` / `pcb_circuit_export`), not the OSC Companion.
 */
export type ProjectEvent = {
  type: "source-changed" | "artifacts-changed"
  projectId: string
  at: number
}

type Listener = (event: ProjectEvent) => void

const DEBOUNCE_MS = 400

const listeners = new Set<Listener>()
const watchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function onProjectEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: ProjectEvent) {
  for (const listener of listeners) listener(event)
}

function schedule(projectId: string, type: ProjectEvent["type"]) {
  const key = `${projectId}:${type}`
  const existing = debounceTimers.get(key)
  if (existing) clearTimeout(existing)
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key)
      emit({ type, projectId, at: Date.now() })
    }, DEBOUNCE_MS),
  )
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
  if (typeof (watcher as { unref?: () => void }).unref === "function") {
    ;(watcher as { unref: () => void }).unref()
  }
  watchers.set(key, watcher)
}

/** Close all PCB project watchers (host shutdown / tests). */
export function closeAllProjectWatchers() {
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  for (const watcher of watchers.values()) {
    try {
      watcher.close()
    } catch {
      // already closed
    }
  }
  watchers.clear()
  listeners.clear()
}

function watchDist(project: CircuitProjectDescriptor) {
  const distDir = path.join(project.absolutePath, "dist")
  watchPath(
    `dist:${project.absolutePath}`,
    distDir,
    () => true,
    () => {
      schedule(project.id, "artifacts-changed")
    },
  )
}

function watchProject(project: CircuitProjectDescriptor) {
  const sourceDir = path.dirname(project.circuitSource)
  const sourceFile = path.basename(project.circuitSource)
  watchPath(
    `source:${project.absolutePath}`,
    sourceDir,
    (filename) => filename === sourceFile,
    () => {
      schedule(project.id, "source-changed")
    },
  )

  // Watch project root so a newly created dist/ can be attached later.
  watchPath(
    `root:${project.absolutePath}`,
    project.absolutePath,
    (filename) => filename === "dist",
    () => {
      watchDist(project)
      schedule(project.id, "artifacts-changed")
    },
  )
  watchDist(project)
}

/**
 * Start observation watchers for discovered projects.
 * Cheap to call repeatedly — already-watched projects are skipped.
 */
export async function ensureWatching(workspaceRoot: string): Promise<void> {
  try {
    const projects = await discoverProjectDescriptors(workspaceRoot)
    for (const project of projects) watchProject(project)
  } catch {
    // discovery failed — watching disabled
  }
}
