import type { ReactNode } from "react"

export function StudioHomeHeader({ title, count, eyebrow = "Studio Home" }: { title: string; count?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
      <div>
        <p className="mb-1 text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">{eyebrow}</p>
        <h1 className="text-pretty text-xl font-semibold tracking-tight text-[var(--osc-text)] sm:text-2xl">{title}</h1>
      </div>
      {count != null ? <span className="font-mono text-[12px] text-[var(--osc-text-muted)] tabular-nums">{count}</span> : null}
    </div>
  )
}

export type StudioHomeFilterOption = { value: string; label: string }

export function StudioHomeTools({
  searchId,
  searchLabel,
  searchPlaceholder,
  search,
  onSearch,
  filterAriaLabel,
  filters,
  filter,
  onFilter,
  searchClassName,
  filterClassName,
  toolsClassName,
  filtersClassName,
}: {
  searchId: string
  searchLabel: string
  searchPlaceholder: string
  search: string
  onSearch: (value: string) => void
  filterAriaLabel: string
  filters: readonly StudioHomeFilterOption[]
  filter: string
  onFilter: (value: string) => void
  searchClassName: string
  filterClassName: string
  toolsClassName: string
  filtersClassName: string
}) {
  return (
    <search className={toolsClassName} aria-label={searchLabel}>
      <label className="sr-only" htmlFor={searchId}>
        {searchLabel}
      </label>
      <input
        id={searchId}
        type="search"
        name="home-filter"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={searchPlaceholder}
        autoComplete="off"
        spellCheck={false}
        className={searchClassName}
      />
      <fieldset className={filtersClassName}>
        <legend className="sr-only">{filterAriaLabel}</legend>
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filterClassName}
            aria-pressed={filter === option.value}
            onClick={() => onFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
    </search>
  )
}

/** Update URL search params; empty or "all" deletes the key. */
export function patchSearchParams(searchParams: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  if (!value || value === "all") next.delete(key)
  else next.set(key, value)
  return next
}
