import { useEffect, useState, type RefObject } from "react"

/** Track an element's content box; useful for viewers that need a numeric height. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    update()

    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}
