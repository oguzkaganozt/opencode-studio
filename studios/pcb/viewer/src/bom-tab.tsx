import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
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
      <td className="px-4 py-2.5 font-mono text-sm text-[var(--osc-success)] whitespace-nowrap">{entry.mpn ?? "—"}</td>
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
    return <div className="flex items-center justify-center py-24 text-[var(--osc-text-muted)] text-sm">Loading BOM…</div>
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--osc-error)] text-sm">BOM not available. Run pcb_circuit_build first.</div>
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
          <a
            href={api.bomCsvUrl(projectId)}
            download
            className="inline-flex items-center gap-1 rounded-md border border-[var(--osc-border-strong)] px-2 py-0.5 text-xs text-[var(--osc-text)] hover:border-[var(--osc-text-faint)] hover:text-[var(--osc-text)] transition-colors"
          >
            Download CSV ↓
          </a>
        </span>
      </div>
      <div className="border border-[var(--osc-border)] rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-[var(--osc-bg-elevated)] border-b border-[var(--osc-border)]">
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-muted)] uppercase tracking-wider">MPN</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-muted)] uppercase tracking-wider">Refdes</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-muted)] uppercase tracking-wider text-center">Qty</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-muted)] uppercase tracking-wider">Manufacturer</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-muted)] uppercase tracking-wider">Description</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--osc-text-muted)] uppercase tracking-wider" />
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
