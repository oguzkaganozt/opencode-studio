/** App-level Status dialog open/close (not a route). Compatible with useSyncExternalStore. */

let open = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function isStatusDialogOpen(): boolean {
  return open
}

export function openStatusDialog() {
  if (open) return
  open = true
  emit()
}

export function closeStatusDialog() {
  if (!open) return
  open = false
  emit()
}

export function subscribeStatusDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test helper */
export function resetStatusDialogForTests() {
  open = false
  listeners.clear()
}
