import { type RefObject, useEffect, useRef } from "react"

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute("disabled") || el.tabIndex === -1) return false
    if (el.getAttribute("aria-hidden") === "true") return false
    return true
  })
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
    document.body.style.overflow = "hidden"

    const focusInitial = () => {
      const container = containerRef.current
      if (!container) return
      const nodes = getFocusable(container)
      const preferred = container.querySelector<HTMLElement>("[data-autofocus]") ?? nodes[0]
      preferred?.focus()
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
        container.focus()
        return
      }
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKey)
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = prevOverflow
      document.removeEventListener("keydown", onKey)
      previousFocus.current?.focus?.()
    }
  }, [active, containerRef])
}
