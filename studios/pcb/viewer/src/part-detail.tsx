import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogHeader } from "@ui/components/dialog"
import { ErrorState } from "@ui/components/error-state"
import { safeHref } from "@ui/lib/safe-href"
import { api, type BomEntry, type CatalogPartDetail } from "./api"

const PRIMARY_KEYS = ["mpn", "manufacturer", "description", "category", "datasheet"] as const

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ")
  return String(value)
}

function formatLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase())
}

function FieldValue({ value }: { value: unknown }) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return <pre className="pcb-part-structured">{JSON.stringify(value, null, 2)}</pre>
  }
  return <span className="font-mono text-[12px] text-[var(--osc-text-muted)]">{formatValue(value)}</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[11px] font-medium tracking-[0.08em] text-[var(--osc-text-faint)] uppercase">{label}</dt>
      <dd className="min-w-0 text-sm text-[var(--osc-text)] break-words">{children}</dd>
    </div>
  )
}

export function PartDetailView({ part }: { part: CatalogPartDetail }) {
  const datasheet = safeHref(typeof part.datasheet === "string" ? part.datasheet : null)
  const extras = Object.entries(part).filter(([key]) => !PRIMARY_KEYS.includes(key as (typeof PRIMARY_KEYS)[number]))

  return (
    <div className="space-y-5">
      <dl className="space-y-3">
        <Field label="MPN">
          <span className="font-mono text-[var(--osc-accent)]">{part.mpn}</span>
        </Field>
        <Field label="Manufacturer">{part.manufacturer?.trim() || "—"}</Field>
        <Field label="Category">{part.category?.trim() || "—"}</Field>
        <Field label="Description">{part.description?.trim() || "—"}</Field>
        <Field label="Datasheet">
          {datasheet ? (
            <a href={datasheet} target="_blank" rel="noopener noreferrer" className="text-[var(--osc-accent)] hover:opacity-80">
              Open datasheet ↗
            </a>
          ) : (
            "—"
          )}
        </Field>
      </dl>

      {extras.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-[var(--osc-text-faint)] uppercase">Additional fields</p>
          <dl className="space-y-3 rounded-lg border border-[var(--osc-border)] bg-[var(--osc-bg)] px-3 py-3">
            {extras.map(([key, value]) => (
              <Field key={key} label={formatLabel(key)}>
                <FieldValue value={value} />
              </Field>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-[var(--osc-text-muted)] text-sm">
      <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" aria-label="Loading" role="img">
        <title>Loading</title>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  )
}

function bomEntryAsPart(entry: BomEntry): CatalogPartDetail {
  return {
    mpn: entry.mpn ?? "—",
    ...(entry.manufacturer ? { manufacturer: entry.manufacturer } : {}),
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.datasheet ? { datasheet: entry.datasheet } : {}),
    refdes: entry.refdes,
    quantity: entry.quantity,
  }
}

export function PartDetailModal({
  mpn,
  onClose,
  fallback,
}: {
  mpn: string
  onClose: () => void
  /** Used when catalog has no file for this MPN (common for circuit-only identities). */
  fallback?: BomEntry | CatalogPartDetail | null
}) {
  const { data, isLoading, error, isFetched } = useQuery({
    queryKey: ["pcb", "part", mpn],
    queryFn: () => api.catalogPart(mpn),
    retry: false,
  })
  const catalogPart = data?.part
  const fallbackPart: CatalogPartDetail | null = !fallback
    ? null
    : Array.isArray((fallback as BomEntry).refdes)
      ? bomEntryAsPart(fallback as BomEntry)
      : (fallback as CatalogPartDetail)
  // Prefer catalog; on miss/error use BOM/circuit fallback when provided.
  const part = catalogPart ?? (!isLoading && fallbackPart ? fallbackPart : null)
  const fromBomOnly = Boolean(!catalogPart && part && fallbackPart && (error || isFetched))

  return (
    <Dialog open onClose={onClose} title={`Part detail: ${mpn}`}>
      <DialogHeader title={mpn} onClose={onClose} />
      <div className="max-h-[min(70dvh,32rem)] overflow-auto overscroll-contain p-5">
        {isLoading && !part && <LoadingState />}
        {fromBomOnly && (
          <p className="mb-3 text-[12px] text-[var(--osc-text-muted)]">Not in workspace catalog — showing BOM line fields only.</p>
        )}
        {part && <PartDetailView part={part} />}
        {!isLoading && !part && <ErrorState className="border-0 py-12" title="Failed to load part details" />}
      </div>
    </Dialog>
  )
}
