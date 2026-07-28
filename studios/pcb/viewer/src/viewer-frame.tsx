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
    <div
      ref={ref}
      className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-md ${className}`}
      style={{ minHeight: "min(560px, 50dvh)" }}
    >
      {ready ? (
        typeof children === "function" ? (
          children(size)
        ) : (
          <div className="min-h-0 flex-1">{children}</div>
        )
      ) : null}
    </div>
  )
}
