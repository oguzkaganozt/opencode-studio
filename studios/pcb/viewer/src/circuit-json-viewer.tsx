import { useQuery } from "@tanstack/react-query"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { api } from "./api"
import { circuitElementPage, filterCircuitElements, type IndexedCircuitElement } from "./circuit-json"
import { LoadingState, PageError } from "./page-states"

export function formatCircuitElementAnnotation(item: IndexedCircuitElement) {
  const el = item.element
  const parts = [
    `type=${item.type}`,
    el.name != null ? `name=${String(el.name)}` : null,
    el.source_component_id != null ? `source_component_id=${String(el.source_component_id)}` : null,
    el.source_net_id != null ? `source_net_id=${String(el.source_net_id)}` : null,
    `index=${item.index}`,
  ].filter(Boolean)
  return parts.join(" ")
}

export function CircuitJsonViewer({ projectId, directory }: { projectId: string; directory: string }) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const deferredSearch = useDeferredValue(search)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pcb", "circuitJson", projectId],
    queryFn: async () => {
      const response = await fetch(api.circuitJsonUrl(projectId))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    },
  })
  const elements = Array.isArray(data) ? data : []
  const normalizedSearch = deferredSearch.trim().toLowerCase()
  const filtered = useMemo(() => filterCircuitElements(elements, normalizedSearch), [elements, normalizedSearch])
  const paged = circuitElementPage(filtered, page)
  const selected = selectedIndex == null ? null : (filtered.find((item) => item.index === selectedIndex) ?? null)

  useEffect(() => setPage(0), [normalizedSearch, data])

  const sendElement = (item: IndexedCircuitElement) => {
    const label = String(item.element.name ?? item.element.source_component_id ?? item.element.source_net_id ?? `[${item.index}]`)
    requestAgentHandoff({
      text: `Inspect PCB circuit element "${label}" in project ${projectId}.`,
      source: "pcb",
      directory,
      paths: [directory],
      annotation: formatCircuitElementAnnotation(item),
      open: true,
      copyFallback: true,
    })
  }

  if (isLoading) return <LoadingState label="Loading circuit.json…" />
  if (error)
    return (
      <PageError
        message="Circuit JSON is unavailable"
        description="Build the project if artifacts do not exist. If it is already built, retry the request."
        onRetry={() => void refetch()}
      />
    )
  if (!Array.isArray(data)) {
    return <PageError message="Circuit JSON has an unexpected format" description="Rebuild the project, then retry this view." onRetry={() => void refetch()} />
  }

  const typeCounts = new Map<string, number>()
  for (const item of filtered) typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1)
  const byType = new Map<string, IndexedCircuitElement[]>()
  for (const item of paged.elements) {
    const group = byType.get(item.type)
    if (group) group.push(item)
    else byType.set(item.type, [item])
  }
  const visibleTypes = [...byType.keys()].sort()

  return (
    <div className="pcb-json-viewer flex min-h-[min(560px,50dvh)] flex-1 flex-col">
      <div className="pcb-json-toolbar">
        <label className="sr-only" htmlFor="pcb-circuit-json-filter">
          Filter elements
        </label>
        <input
          id="pcb-circuit-json-filter"
          type="search"
          name="circuit-json-filter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by type, name, or ID…"
          autoComplete="off"
          spellCheck={false}
          className="pcb-input flex-1 px-3 py-1.5"
        />
        <span className="shrink-0 text-xs text-[var(--osc-text-muted)] tabular-nums" aria-live="polite">
          {filtered.length === elements.length ? `${elements.length} elements` : `${filtered.length} of ${elements.length}`} · {typeCounts.size}{" "}
          {typeCounts.size === 1 ? "type" : "types"}
        </span>
        <button type="button" className="pcb-chip pcb-chip--primary" disabled={!selected} onClick={() => selected && sendElement(selected)}>
          Send to agent
        </button>
      </div>
      <div className="pcb-json-list">
        {visibleTypes.map((type) => {
          const group = byType.get(type)
          if (!group) return null
          const totalForType = typeCounts.get(type) ?? group.length
          return (
            <details key={type} className="pcb-json-group">
              <summary className="pcb-json-summary">
                <span className="min-w-0 text-[var(--osc-accent)]">{type}</span>
                <span className="ml-auto shrink-0 pl-2 text-[var(--osc-text-faint)]">
                  ({group.length === totalForType ? totalForType : `${group.length} of ${totalForType}`})
                </span>
              </summary>
              <div className="mt-1 space-y-1 pl-3 border-l border-[var(--osc-border)]">
                {group.map((item) => (
                  <CircuitJsonItem
                    key={item.index}
                    item={item}
                    selected={selectedIndex === item.index}
                    onSelect={() => setSelectedIndex(item.index)}
                    onSend={() => sendElement(item)}
                  />
                ))}
              </div>
            </details>
          )
        })}
        {visibleTypes.length === 0 && (
          <div className="pcb-json-empty">
            <p className="font-medium text-[var(--osc-text)]">No elements match</p>
            <p>Try a type, component name, source ID, or net ID.</p>
            <button type="button" className="pcb-chip" onClick={() => setSearch("")}>
              Clear filter
            </button>
          </div>
        )}
        {filtered.length > 0 && paged.pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-[var(--osc-text-muted)]">
            <button type="button" className="pcb-chip" disabled={paged.page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
              Previous
            </button>
            <span className="tabular-nums">Page {paged.page + 1} of {paged.pageCount}</span>
            <button
              type="button"
              className="pcb-chip"
              disabled={paged.page + 1 >= paged.pageCount}
              onClick={() => setPage((value) => Math.min(paged.pageCount - 1, value + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function CircuitJsonItem({
  item,
  selected,
  onSelect,
  onSend,
}: {
  item: IndexedCircuitElement
  selected: boolean
  onSelect: () => void
  onSend: () => void
}) {
  const [open, setOpen] = useState(false)
  const element = item.element
  const label = element.name ?? element.source_component_id ?? element.source_net_id ?? `[${item.index}]`
  return (
    <div className={`rounded-[var(--osc-radius-sm)] ${selected ? "bg-[var(--osc-surface-hover)] ring-1 ring-[var(--osc-accent)]/40" : ""}`}>
      <div className="flex items-center gap-1">
        <button type="button" className="pcb-json-item-summary min-w-0 flex-1 text-left" onClick={onSelect}>
          {String(label)}
        </button>
        <button type="button" className="pcb-chip shrink-0 px-1.5 py-0.5 text-[10px]" onClick={onSend}>
          Agent
        </button>
        <button type="button" className="pcb-chip shrink-0 px-1.5 py-0.5 text-[10px]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "JSON"}
        </button>
      </div>
      {open ? (
        <pre className="mt-1 bg-[var(--osc-bg)] rounded p-2 text-[var(--osc-text-muted)] overflow-auto text-xs leading-relaxed">
          {JSON.stringify(element, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

