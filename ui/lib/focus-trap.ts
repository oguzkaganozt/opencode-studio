import { type RefObject, useEffect, useRef } from "react"

const FOCUSABLE =
  'a[href], button:not([disabled]), iframe, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute("disabled") || el.tabIndex === -1) return false
    if (el.getAttribute("aria-hidden") === "true") return false
    if (el.closest("[inert]")) return false
    return el.getClientRects().length > 0
  })
}

function canRestoreFocus(el: HTMLElement | null): el is HTMLElement {
  if (!el?.isConnected) return false
  if (el.closest("[inert]")) return false
  if (el.getAttribute("aria-hidden") === "true") return false
  return true
}

/** Trap focus inside `containerRef` while `active`. Restores focus and body scroll on cleanup. */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>, onEscape?: () => void) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!active) return

    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    // Avoid stacking overflow locks when a parent already froze scroll (nested drawers).
    const shouldLock = document.body.style.overflow !== "hidden"
    if (shouldLock) document.body.style.overflow = "hidden"

    const focusInitial = () => {
      const container = containerRef.current
      if (!container) return
      const nodes = getFocusable(container)
      const preferred = container.querySelector<HTMLElement>("[data-autofocus]") ?? nodes[0]
      preferred?.focus({ preventScroll: true })
    }
    const timer = window.setTimeout(focusInitial, 0)

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onEscapeRef.current?.()
        return
      }
      if (event.key !== "Tab") return
      const container = containerRef.current
      if (!container) return
      const nodes = getFocusable(container)
      if (nodes.length === 0) {
        event.preventDefault()
        container.setAttribute("tabindex", "-1")
        container.focus({ preventScroll: true })
        return
      }
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener("keydown", onKey)
    return () => {
      window.clearTimeout(timer)
      if (shouldLock) document.body.style.overflow = prevOverflow
      document.removeEventListener("keydown", onKey)
      const restore = previousFocus.current
      previousFocus.current = null
      if (canRestoreFocus(restore)) {
        try {
          restore.focus({ preventScroll: true })
        } catch {
          // iOS may throw if the node left the tab order mid-gesture
        }
      }
    }
  }, [active, containerRef])
}
