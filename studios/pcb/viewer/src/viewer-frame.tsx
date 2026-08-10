import { useRef, type ReactNode } from "react"
import { useElementSize } from "./use-element-size"

/** Flex-fill host for PCB viewers — replaces fixed h-[560px]. */
export function ViewerFrame({
  children,
  label,
  className = "",
}: {
  children: ReactNode | ((size: { width: number; height: number }) => ReactNode)
  label: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useElementSize(ref)
  const ready = size.height > 0 && size.width > 0

  return (
    <div
      ref={ref}
      className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] ${className}`}
      role="region"
      aria-label={label}
    >
      {ready ? (
        typeof children === "function" ? (
          children(size)
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:h-full">
            {children}
          </div>
        )
      ) : (
        <div className="flex flex-1 items-center justify-center" role="status" aria-busy="true">
          <span className="sr-only">Preparing viewer…</span>
          <div className="osc-skeleton h-32 w-48 max-w-[70%]" aria-hidden />
        </div>
      )}
    </div>
  )
}
