import { existsSync, type FSWatcher, watch } from "node:fs"
import { type FwProject, listFwProjects, simDir } from "./workspace"

export type FwProjectEvent = {
  type: "projects-changed" | "artifacts-changed"
  projectId?: string
  at: number
}

type Listener = (event: FwProjectEvent) => void

const DEBOUNCE_MS = 400

const listeners = new Set<Listener>()
const watchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function onFwProjectEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: FwProjectEvent) {
  for (const listener of listeners) listener(event)
}

function schedule(key: string, event: FwProjectEvent) {
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

function scheduleRewatch(workspaceRoot: string) {
  const key = `rewatch:${workspaceRoot}`
  const existing = debounceTimers.get(key)
  if (existing) clearTimeout(existing)
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key)
      void ensureFwWatching(workspaceRoot)
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

function closeProjectWatchers() {
  for (const key of [...watchers.keys()]) {
    if (key.startsWith("workspace:")) continue
    dropWatcher(key)
  }
}

export function closeAllFwWatchers() {
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  for (const key of [...watchers.keys()]) dropWatcher(key)
  listeners.clear()
}

function watchSim(project: FwProject) {
  watchPath(
    `sim:${project.directory}`,
    simDir(project.directory),
    () => true,
    () => {
      schedule(`artifacts:${project.id}`, { type: "artifacts-changed", projectId: project.id, at: Date.now() })
    },
  )
}

function watchProject(project: FwProject) {
  watchPath(
    `root:${project.directory}`,
    project.directory,
    (filename) => String(filename ?? "").replace(/\/$/, "") === "sim",
    () => {
      watchSim(project)
      schedule(`artifacts:${project.id}`, { type: "artifacts-changed", projectId: project.id, at: Date.now() })
    },
  )
  watchSim(project)
}

export async function ensureFwWatching(workspaceRoot: string): Promise<void> {
  try {
    watchPath(
      `workspace:${workspaceRoot}`,
      workspaceRoot,
      () => true,
      () => {
        schedule(`projects:${workspaceRoot}`, { type: "projects-changed", at: Date.now() })
        scheduleRewatch(workspaceRoot)
      },
    )
    const projects = await listFwProjects(workspaceRoot)
    closeProjectWatchers()
    for (const project of projects) watchProject(project)
  } catch {
    // discovery failed — watching disabled
  }
}
