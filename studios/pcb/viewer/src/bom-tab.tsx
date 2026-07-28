import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ErrorState } from "@ui/components/error-state"
import { api, type BomEntry } from "./api"
import { PartDetailModal } from "./part-detail"

function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

function BomRow({ entry, onSelect }: { entry: BomEntry; onSelect?: (entry: BomEntry) => void }) {
  const clickable = Boolean(entry.mpn && onSelect)
  return (
    <tr
      className={`border-b border-[var(--osc-border)] transition-colors hover:bg-[var(--osc-surface-hover)] ${clickable ? "cursor-pointer" : ""}`}
      tabIndex={clickable ? 0 : undefined}
      aria-label={entry.mpn ? `BOM line ${entry.mpn}` : "BOM line without MPN"}
      onClick={() => {
        if (entry.mpn && onSelect) onSelect(entry)
      }}
      onKeyDown={(event) => {
        if (!clickable) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect?.(entry)
        }
      }}
    >
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm text-[var(--osc-accent)]">{entry.mpn ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text)]">{entry.refdes.join(", ")}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text)] text-center">{entry.quantity}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)]">{entry.manufacturer ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)] max-w-xs truncate" title={entry.description ?? ""}>
        {entry.description ?? "—"}
      </td>
      <td className="px-4 py-2.5 text-sm">
        {entry.datasheet && safeHref(entry.datasheet) && (
          <a
            href={safeHref(entry.datasheet)!}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--osc-accent)] hover:opacity-80 text-xs"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            Datasheet ↗
          </a>
        )}
      </td>
    </tr>
  )
}

export default function BomTab({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<BomEntry | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ["pcb", "bom", projectId],
    queryFn: () => api.bom(projectId),
  })

  if (isLoading) {
    return (
      <div className="space-y-2 py-8" role="status" aria-busy="true">
        <span className="sr-only">Loading BOM…</span>
        <div className="pcb-skeleton h-10 w-full" aria-hidden />
        <div className="pcb-skeleton h-10 w-full" aria-hidden />
        <div className="pcb-skeleton h-10 w-2/3" aria-hidden />
      </div>
    )
  }
  if (error || !data) {
    return (
      <ErrorState
        className="m-4 border-0 py-16"
        title="BOM not available"
        description="Run pcb_circuit_build first, then reopen this tab."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-[var(--osc-text-muted)]">
        <span>
          {data.totalComponents} component{data.totalComponents !== 1 ? "s" : ""}
        </span>
        <span className="text-[var(--osc-border-strong)]">·</span>
        <span>
          {data.listedCount} listed{data.unlistedCount > 0 ? `, ${data.unlistedCount} unlisted` : ""}
        </span>
        <span className={data.bomComplete ? "text-[var(--osc-success)]" : "text-[var(--osc-warning)]"}>
          {data.bomComplete ? "Assembly identities complete" : "Assembly blocked: missing part identities"}
        </span>
        <span className="ml-auto">
          <a href={api.bomCsvUrl(projectId)} download className="pcb-chip">
            Download CSV ↓
          </a>
        </span>
      </div>
      <div className="pcb-table-wrap overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>MPN</th>
              <th>Refdes</th>
              <th className="text-center">Qty</th>
              <th>Manufacturer</th>
              <th>Description</th>
              <th>
                <span className="sr-only">Datasheet</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, index) => (
              <BomRow key={entry.mpn ?? `unlisted-${index}`} entry={entry} onSelect={setSelected} />
            ))}
          </tbody>
        </table>
      </div>
      {selected?.mpn && (
        <PartDetailModal mpn={selected.mpn} fallback={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
