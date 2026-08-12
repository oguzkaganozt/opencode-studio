import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { claimAgentContext } from "@ui/agent-context"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { StudioHomeHeader } from "@ui/components/studio-home"
import { api, type PartSummary } from "./api"
import { DatasheetLink } from "./datasheet-link"
import { PartDetailModal } from "./part-detail"
import { LoadingState, PageEmpty, PageError } from "./page-states"
import { Shell } from "./shell"

export function PartRow({ part, onSelect }: { part: PartSummary; onSelect: () => void }) {
  return (
    <tr className="border-b border-[var(--osc-border)] transition-colors hover:bg-[var(--osc-surface-hover)]">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm">
        <button type="button" className="pcb-table-link" onClick={onSelect}>
          {part.mpn}
        </button>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-[var(--osc-text)]">{part.manufacturer ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-[var(--osc-text-muted)]">{part.description ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-[var(--osc-text-muted)]">{part.category ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm">
        {part.hasSpiceModel ? <span className="pcb-data-card__tag">SPICE</span> : <span className="text-[var(--osc-text-faint)]">—</span>}
      </td>
      <td className="px-4 py-2.5 text-sm">
        <DatasheetLink href={part.datasheet} />
      </td>
    </tr>
  )
}

export function PartCard({ part, onSelect }: { part: PartSummary; onSelect: () => void }) {
  return (
    <article className="pcb-data-card">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button type="button" className="pcb-table-link min-w-0 truncate text-left font-mono" onClick={onSelect}>
          {part.mpn}
        </button>
        <div className="flex shrink-0 flex-wrap gap-1">
          {part.hasSpiceModel ? <span className="pcb-data-card__tag">SPICE</span> : null}
          {part.category ? <span className="pcb-data-card__tag">{part.category}</span> : null}
        </div>
      </div>
      <p className="mt-2 text-[13px] text-[var(--osc-text)]">{part.manufacturer ?? "Manufacturer unknown"}</p>
      {part.description ? <p className="mt-1 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">{part.description}</p> : null}
      <DatasheetLink href={part.datasheet} className="mt-3 inline-flex text-xs text-[var(--osc-accent)]" />
    </article>
  )
}

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const search = searchParams.get("q") ?? ""
  const selected = searchParams.get("part")
  const debouncedSearch = useDebounce(search, 200)
  const { data: rootInfo } = useQuery({ queryKey: ["pcb", "workspace"], queryFn: () => api.workspace() })
  useEffect(() => {
    if (!rootInfo?.root) return
    return claimAgentContext("pcb-catalog", {
      key: "pcb-root",
      kind: "pcb-root",
      studioId: "pcb",
      label: "PCB Studio",
      directory: rootInfo.root,
      historicalDirectory: rootInfo.root,
      status: "available",
    })
  }, [rootInfo?.root])

  const updateCatalogSearch = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set("q", value)
    else next.delete("q")
    setSearchParams(next, { replace: true })
  }

  const selectPart = (mpn: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("part", mpn)
    setSearchParams(next, { state: { catalogPartModal: true } })
  }

  const closePart = () => {
    if ((location.state as { catalogPartModal?: boolean } | null)?.catalogPartModal) {
      navigate(-1)
      return
    }
    const next = new URLSearchParams(searchParams)
    next.delete("part")
    setSearchParams(next, { replace: true })
  }

  const requestCatalogHelp = () => {
    requestAgentHandoff({
      text: "Populate the Studio Home PCB catalog (catalog/parts/*.yaml) using pcb_catalog_upsert for verified MPNs only. For analog/power parts that need realistic simulation, use pcb_spice_model_upsert only with a self-contained manufacturer model, HTTPS provenance, and datasheet-verified pin mapping. Do not invent MPNs, footprints, models, or pin mappings.",
      source: "pcb",
      directory: rootInfo?.root,
      open: true,
      copyFallback: true,
    })
  }

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["pcb", "catalog", debouncedSearch],
    queryFn: () => api.catalog(debouncedSearch || undefined),
    placeholderData: (previous) => previous,
  })

  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <StudioHomeHeader
          title="Catalog"
          eyebrow="Library"
          count={data ? `${data.total} part${data.total !== 1 ? "s" : ""}` : undefined}
        />

        <div className="mb-4">
          <label className="sr-only" htmlFor="pcb-catalog-search">
            Search catalog
          </label>
          <input
            id="pcb-catalog-search"
            type="search"
            name="catalog-search"
            value={search}
            onChange={(e) => updateCatalogSearch(e.target.value)}
            placeholder="Search MPN, manufacturer…"
            autoComplete="off"
            spellCheck={false}
            className="pcb-input w-full px-3 py-2 sm:px-4 sm:py-2.5"
          />
        </div>

        {isFetching && !isLoading ? (
          <p className="mb-3 text-[11px] text-[var(--osc-text-muted)]" role="status">
            Searching catalog…
          </p>
        ) : null}

        {isLoading && <LoadingState />}
        {error && <PageError message="Failed to load catalog" description={`${String(error)}. Check the catalog and retry.`} onRetry={() => void refetch()} />}
        {data && data.parts.length === 0 && (
          <PageEmpty
            label={search ? "No parts match" : "Catalog is empty"}
            description={
              search
                ? "Try a shorter MPN or manufacturer token."
                : "Catalog fills from verified BOM MPNs (Add to catalog) or pcb_catalog_upsert after part identity is confirmed."
            }
            action={
              !search ? (
                <button type="button" className="pcb-chip pcb-chip--primary" onClick={requestCatalogHelp}>
                  Seed catalog with agent
                </button>
              ) : undefined
            }
          />
        )}

        {data && data.parts.length > 0 && (
          <>
            <div className="pcb-table-wrap pcb-desktop-table overflow-x-auto">
              <table>
                <caption className="sr-only">PCB component catalog</caption>
                <thead>
                  <tr>
                    <th scope="col">MPN</th>
                    <th scope="col">Manufacturer</th>
                    <th scope="col">Description</th>
                    <th scope="col">Category</th>
                    <th scope="col">Simulation</th>
                    <th scope="col">
                      <span className="sr-only">Datasheet</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.parts.map((p) => (
                    <PartRow key={p.mpn} part={p} onSelect={() => selectPart(p.mpn)} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pcb-mobile-list">
              {data.parts.map((part) => (
                <PartCard key={part.mpn} part={part} onSelect={() => selectPart(part.mpn)} />
              ))}
            </div>
          </>
        )}
      </div>

      {selected && <PartDetailModal mpn={selected} onClose={closePart} />}
    </Shell>
  )
}

// ── Hooks ─────────────────────────────────────────────────────────────────────


function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
