import { useRef, type ReactNode } from "react"
import { useElementSize } from "./use-element-size"

/** Flex-fill host for PCB viewers — replaces fixed h-[560px]. */
export function ViewerFrame({
  children,
  className = "",
}: {
  children: ReactNode | ((size: { width: number; height: number }) => ReactNode)
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useElementSize(ref)
  const ready = size.height > 0 && size.width > 0

  return (
    <div ref={ref} className={`h-full min-h-[min(560px,50dvh)] w-full flex-1 overflow-hidden rounded-md ${className}`}>
      {ready ? (typeof children === "function" ? children(size) : children) : null}
    </div>
  )
}
