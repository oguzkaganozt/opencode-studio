import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { api, type BomEntry } from "./api"
import { DatasheetLink } from "./datasheet-link"
import { PartDetailModal } from "./part-detail"

function summarizeRefdes(refdes: string[], limit: number) {
  if (refdes.length <= limit) return refdes.join(", ")
  return `${refdes.slice(0, limit).join(", ")} +${refdes.length - limit} more`
}

function supplierIdentity(entry: BomEntry) {
  const identities = Object.entries(entry.supplierPartNumbers).flatMap(([supplier, partNumbers]) =>
    partNumbers.map((partNumber) => `${supplier}: ${partNumber}`),
  )
  return identities.length > 0 ? identities.join(" · ") : null
}

function hasPartIdentity(entry: BomEntry) {
  return Boolean(entry.mpn || supplierIdentity(entry))
}

function formatBomAnnotation(entry: BomEntry) {
  return [
    entry.mpn ? `mpn=${entry.mpn}` : null,
    `refdes=${entry.refdes.join(",")}`,
    `qty=${entry.quantity}`,
    entry.manufacturer ? `manufacturer=${entry.manufacturer}` : null,
    entry.description ? `description=${entry.description}` : null,
    supplierIdentity(entry) ? `supplier=${supplierIdentity(entry)}` : null,
  ]
    .filter(Boolean)
    .join(" ")
}

function BomRow({
  entry,
  onSelect,
  onSend,
}: {
  entry: BomEntry
  onSelect?: (entry: BomEntry) => void
  onSend?: (entry: BomEntry) => void
}) {
  const clickable = Boolean(entry.mpn && onSelect)
  const refdes = summarizeRefdes(entry.refdes, 8)
  const supplierPartNumber = supplierIdentity(entry)
  return (
    <tr className="border-b border-[var(--osc-border)] transition-colors hover:bg-[var(--osc-surface-hover)]">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm">
        {clickable ? (
          <button type="button" className="pcb-table-link" onClick={() => onSelect?.(entry)}>
            {entry.mpn}
          </button>
        ) : supplierPartNumber ? (
          <span className="text-[var(--osc-accent)]">{supplierPartNumber}</span>
        ) : (
          <span className="text-[var(--osc-warning)]">Missing identity</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text)]" title={entry.refdes.join(", ")}>
        {refdes}
      </td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text)] text-center">{entry.quantity}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)]">{entry.manufacturer ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)] max-w-xs truncate" title={entry.description ?? ""}>
        {entry.description ?? "—"}
      </td>
      <td className="px-4 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <DatasheetLink href={entry.datasheet} />
          {onSend ? (
            <button type="button" className="pcb-chip px-1.5 py-0.5 text-[10px]" onClick={() => onSend(entry)}>
              Agent
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function BomCard({
  entry,
  onSelect,
  onSend,
}: {
  entry: BomEntry
  onSelect: (entry: BomEntry) => void
  onSend?: (entry: BomEntry) => void
}) {
  const supplierPartNumber = supplierIdentity(entry)
  const identified = hasPartIdentity(entry)
  return (
    <article className={`pcb-data-card${identified ? "" : " pcb-data-card--warning"}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        {entry.mpn ? (
          <button type="button" className="pcb-table-link min-w-0 truncate text-left font-mono" onClick={() => onSelect(entry)}>
            {entry.mpn}
          </button>
        ) : supplierPartNumber ? (
          <span className="min-w-0 text-[var(--osc-accent)] font-mono">{supplierPartNumber}</span>
        ) : (
          <span className="font-medium text-[var(--osc-warning)]">Missing part identity</span>
        )}
        <span className="pcb-data-card__tag">Qty {entry.quantity}</span>
      </div>
      <p className="mt-2 font-mono text-[12px] leading-relaxed text-[var(--osc-text)]" title={entry.refdes.join(", ")}>
        {summarizeRefdes(entry.refdes, 6)}
      </p>
      {entry.manufacturer || entry.description ? (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">
          {[entry.manufacturer, entry.description].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DatasheetLink href={entry.datasheet} className="inline-flex text-xs text-[var(--osc-accent)]" />
        {onSend ? (
          <button type="button" className="pcb-chip px-1.5 py-0.5 text-[10px]" onClick={() => onSend(entry)}>
            Send to agent
          </button>
        ) : null}
      </div>
    </article>
  )
}

export default function BomTab({ projectId, directory }: { projectId: string; directory: string }) {
  const [selected, setSelected] = useState<BomEntry | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pcb", "bom", projectId],
    queryFn: () => api.bom(projectId),
  })

  if (isLoading) {
    return (
      <div className="space-y-2 py-8" role="status" aria-busy="true">
        <span className="sr-only">Loading BOM…</span>
        <div className="osc-skeleton h-10 w-full" aria-hidden />
        <div className="osc-skeleton h-10 w-full" aria-hidden />
        <div className="osc-skeleton h-10 w-2/3" aria-hidden />
      </div>
    )
  }
  if (error || !data) {
    return (
      <ErrorState
        className="m-4 border-0 py-16"
        title="BOM not available"
        description="Build the project if BOM artifacts do not exist. If it is already built, retry the request."
        action={
          <button type="button" className="pcb-chip" onClick={() => void refetch()}>
            Retry
          </button>
        }
      />
    )
  }

  if (data.entries.length === 0) {
    return (
      <EmptyState
        className="m-4 border-dashed py-16"
        title="No BOM lines"
        description="The circuit has no billable components, or the build produced an empty BOM."
      />
    )
  }

  const requestIdentityFix = () => {
    const missing = data.entries.filter((entry) => !hasPartIdentity(entry)).flatMap((entry) => entry.refdes)
    requestAgentHandoff({
      text: `PCB project ${projectId} has ${data.unlistedCount} components without assembly identities. Identify verified manufacturer part numbers for these references, update the circuit source, rebuild, and regenerate the BOM: ${missing.join(", ")}`,
      source: "pcb",
      directory,
      paths: [directory],
      open: true,
      copyFallback: true,
    })
  }

  const sendEntry = (entry: BomEntry) => {
    requestAgentHandoff({
      text: `Inspect BOM line in PCB project ${projectId} (${entry.refdes.join(", ") || "no refdes"}).`,
      source: "pcb",
      directory,
      paths: [directory],
      annotation: formatBomAnnotation(entry),
      open: true,
      copyFallback: true,
    })
  }

  return (
    <div className="pcb-bom-tab min-h-0 flex-1 space-y-4 overflow-auto overscroll-contain pb-1">
      <div className="pcb-bom-overview">
        <div className="pcb-bom-metrics" aria-label="BOM summary">
          <span>
            <strong>{data.totalComponents}</strong>
            <small>Components</small>
          </span>
          <span>
            <strong>{data.entries.length}</strong>
            <small>Part groups</small>
          </span>
          <span data-tone={data.unlistedCount > 0 ? "warning" : "success"}>
            <strong>{data.unlistedCount}</strong>
            <small>Missing IDs</small>
          </span>
        </div>
        <div className="pcb-bom-status">
          <span className={data.bomComplete ? "text-[var(--osc-success)]" : "text-[var(--osc-warning)]"}>
            {data.bomComplete ? "Assembly identities complete" : "Assembly blocked by missing identities"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {!data.bomComplete ? (
              <button type="button" className="pcb-chip pcb-chip--primary" onClick={requestIdentityFix}>
                Fix identities with agent
              </button>
            ) : null}
            <a href={api.bomCsvUrl(projectId)} download className="pcb-chip pcb-chip--action">
              Download CSV
            </a>
          </div>
        </div>
      </div>
      <div className="pcb-table-wrap pcb-desktop-table overflow-x-auto">
        <table>
          <caption className="sr-only">Bill of materials</caption>
          <thead>
            <tr>
              <th scope="col">MPN</th>
              <th scope="col">Refdes</th>
              <th scope="col" className="text-center">Qty</th>
              <th scope="col">Manufacturer</th>
              <th scope="col">Description</th>
              <th scope="col">
                <span className="sr-only">Datasheet</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, index) => (
              <BomRow
                key={entry.mpn ?? supplierIdentity(entry) ?? `unlisted-${index}`}
                entry={entry}
                onSelect={setSelected}
                onSend={sendEntry}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="pcb-mobile-list">
        {data.entries.map((entry, index) => (
          <BomCard
            key={entry.mpn ?? supplierIdentity(entry) ?? `unlisted-${index}`}
            entry={entry}
            onSelect={setSelected}
            onSend={sendEntry}
          />
        ))}
      </div>
      {selected?.mpn && <PartDetailModal mpn={selected.mpn} fallback={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
