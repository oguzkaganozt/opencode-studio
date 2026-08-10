import { useEffect, useState } from "react"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Badge } from "@ui/components/badge"
import { cn } from "@ui/lib/cn"
import type { CircuitDiagnostics, DiagnosticGroup } from "./api"

export function diagnosticLabel(type: string) {
  const words = type.replace(/_(warning|error)$/, "").split("_")
  const scope = words.shift()
  const scopeLabel = scope === "pcb" ? "PCB" : scope ? scope[0].toUpperCase() + scope.slice(1) : "Design"
  const message = words.join(" ")
  return message ? `${scopeLabel}: ${message[0].toUpperCase()}${message.slice(1)}` : scopeLabel
}

export function DiagnosticGroupList({ groups, tone }: { groups: DiagnosticGroup[]; tone: "warning" | "error" }) {
  const count = groups.reduce((total, group) => total + group.count, 0)
  return (
    <section className="min-w-0 space-y-2" aria-label={tone === "error" ? "Errors" : "Warnings"}>
      <div className="pcb-diag-section-heading" data-tone={tone}>
        <span>{tone === "error" ? "Errors" : "Warnings"}</span>
        <span>
          {count} across {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <details key={group.type} open={tone === "error"} className="pcb-diag-group">
            <summary className="pcb-diag-group-summary">
              <span className="min-w-0">{diagnosticLabel(group.type)}</span>
              <span className="pcb-diag-group-count" data-tone={tone}>
                {group.count}
              </span>
            </summary>
            <div className="pcb-diag-group-content">
              <code>{group.type}</code>
              {group.messages.length > 0 && (
                <ul>
                  {group.messages.map((message, index) => (
                    <li key={`${group.type}-${index}`}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

export function formatDiagnosticsHandoff(projectId: string, projectName: string, diagnostics: CircuitDiagnostics) {
  const lines = [
    `PCB project "${projectName}" (${projectId}) has design diagnostics that need fixing.`,
    `Errors: ${diagnostics.errorCount}, warnings: ${diagnostics.warningCount}.`,
    "Use pcb_circuit_build / pcb_circuit_read, fix issues, and re-check designValid / fabricationReady / assemblyReady.",
  ]
  for (const group of diagnostics.errors) {
    lines.push(`Error ${group.type} (${group.count}):`)
    for (const message of group.messages.slice(0, 8)) lines.push(`  - ${message}`)
    if (group.messages.length > 8) lines.push(`  - … ${group.messages.length - 8} more`)
  }
  for (const group of diagnostics.warnings) {
    lines.push(`Warning ${group.type} (${group.count}):`)
    for (const message of group.messages.slice(0, 5)) lines.push(`  - ${message}`)
    if (group.messages.length > 5) lines.push(`  - … ${group.messages.length - 5} more`)
  }
  return lines.join("\n")
}

export function DiagnosticsPanel({
  diagnostics,
  projectId,
  projectName,
  directory,
}: {
  diagnostics: CircuitDiagnostics
  projectId: string
  projectName: string
  directory: string
}) {
  const [toast, setToast] = useState<string | null>(null)
  const [open, setOpen] = useState(diagnostics.errorCount > 0)

  const showToast = (message: string) => {
    setToast(message)
  }

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (diagnostics.errorCount > 0) setOpen(true)
  }, [diagnostics.errorCount])

  if (diagnostics.errorCount === 0 && diagnostics.warningCount === 0) return null

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="pcb-diag relative shrink-0 rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow)]"
      aria-label="Design diagnostics"
    >
      <summary className="pcb-diag-summary">
        <span className="pcb-diag-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="pcb-diag-title">Design diagnostics</span>
        {diagnostics.errorCount > 0 && (
          <Badge tone="fail" dot>
            {diagnostics.errorCount} errors
          </Badge>
        )}
        {diagnostics.warningCount > 0 && (
          <Badge tone="warn" dot>
            {diagnostics.warningCount} warnings
          </Badge>
        )}
      </summary>
      <div className="pcb-diag-content space-y-3 overflow-auto overscroll-contain border-t border-[var(--osc-border)] px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="pcb-chip pcb-chip--primary"
            onClick={() => {
              requestAgentHandoff({
                text: formatDiagnosticsHandoff(projectId, projectName, diagnostics),
                source: "pcb",
                directory,
                open: true,
                copyFallback: true,
              })
              showToast("Opened repair draft in agent")
            }}
          >
            Fix with agent
          </button>
          <span className="text-[11px] text-[var(--osc-text-muted)]">Review the draft before sending</span>
        </div>
        <div className={cn("grid gap-3", diagnostics.errors.length > 0 && diagnostics.warnings.length > 0 && "lg:grid-cols-2")}>
          {diagnostics.errors.length > 0 && <DiagnosticGroupList groups={diagnostics.errors} tone="error" />}
          {diagnostics.warnings.length > 0 && <DiagnosticGroupList groups={diagnostics.warnings} tone="warning" />}
        </div>
      </div>
      {toast && (
        <div
          className="absolute top-2 right-3 z-10 rounded-[var(--osc-radius-md)] border border-[var(--osc-success)]/30 bg-[var(--osc-success-bg)] px-3 py-1.5 text-xs font-medium text-[var(--osc-success)]"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </details>
  )
}

