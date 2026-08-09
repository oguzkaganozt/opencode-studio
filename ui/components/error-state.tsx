import type { ReactNode } from "react"
import { StatePanel } from "./empty-state"

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return <StatePanel tone="error" title={title} description={description} action={action} className={className} />
}
