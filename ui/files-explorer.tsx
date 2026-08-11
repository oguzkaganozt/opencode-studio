import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { EmptyState } from "./components/empty-state"
import { ErrorState } from "./components/error-state"
import { fetchJson } from "./lib/fetch-json"

type FileEntry = {
  name: string
  path: string
  kind: "dir" | "file"
  bytes?: number
  mime?: string
  preview: "image" | "audio" | "video" | "text" | "none"
}

type TreeResponse = { path: string; entries: FileEntry[] }
type ContentResponse = {
  path: string
  preview: string
  bytes?: number
  mime?: string
  text?: string | null
  truncated?: boolean
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return ""
  const units = ["B", "KB", "MB", "GB", "TB"]
  const unitIndex = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unitIndex === 0 ? 0 : 1 }).format(value)} ${units[unitIndex]}`
}

function parentPath(current: string) {
  if (!current) return null
  const parts = current.split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path
        d="M1.5 3.5A1.5 1.5 0 0 1 3 2h2.2c.3 0 .6.1.8.3L7 3.5h4A1.5 1.5 0 0 1 12.5 5v5.5A1.5 1.5 0 0 1 11 12H3A1.5 1.5 0 0 1 1.5 10.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 1.5h4.2L11.5 5v6.5A1 1 0 0 1 10.5 12.5h-6A1 1 0 0 1 3.5 11.5v-9A1 1 0 0 1 4.5 1.5H4Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function UpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 11V3.5M4 6l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M11.5 7A4.5 4.5 0 1 1 9.8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.5 1.8v2.6h2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MobileBack({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null
  return (
    <button type="button" className="osc-chip osc-mobile-only h-10 shrink-0 px-2.5 text-[11px]" onClick={onBack}>
      ← List
    </button>
  )
}

function PreviewChrome({
  onBack,
  children,
  trailing,
  tall,
}: {
  onBack?: () => void
  children?: ReactNode
  trailing?: ReactNode
  tall?: boolean
}) {
  if (!onBack && !children && !trailing) return null
  return (
    <div
      className={`flex shrink-0 items-center gap-3 border-b border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-3 ${
        tall || children || trailing ? "h-12 sm:px-4" : "h-10"
      } ${trailing || children ? "justify-between" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <MobileBack onBack={onBack} />
        {children}
      </div>
      {trailing}
    </div>
  )
}

function PreviewActions({
  selected,
  onRequestAgent,
  apiBase,
}: {
  selected: FileEntry
  onRequestAgent?: (path: string) => void
  apiBase: string
}) {
  const downloadHref = `${apiBase}/raw?path=${encodeURIComponent(selected.path)}&download=1`
  return (
    <div className="flex shrink-0 items-center gap-2">
      {onRequestAgent ? (
        <button type="button" className="osc-chip h-10 px-2.5 text-[11px] sm:h-8" onClick={() => onRequestAgent(selected.path)}>
          Use in Agent
        </button>
      ) : null}
      <a href={downloadHref} className="osc-chip h-10 px-2.5 text-[11px] sm:h-8">
        Download
      </a>
    </div>
  )
}

function PreviewPane({
  selected,
  selectedPath,
  onBack,
  onRequestAgent,
  apiBase,
}: {
  selected: FileEntry | null
  selectedPath: string | null
  onBack?: () => void
  onRequestAgent?: (path: string) => void
  apiBase: string
}) {
  const [mediaError, setMediaError] = useState(false)
  const contentQuery = useQuery({
    queryKey: ["files", apiBase, "content", selected?.path],
    enabled: Boolean(selected && selected.kind === "file"),
    queryFn: () => fetchJson<ContentResponse>(`${apiBase}/content?path=${encodeURIComponent(selected!.path)}`),
  })

  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)]">
        <PreviewChrome onBack={onBack} />
        <EmptyState
          className="m-6 max-w-sm self-center border-0 bg-transparent py-12 sm:mt-16"
          title={selectedPath ? "File unavailable" : "Select a file to preview"}
          description={
            selectedPath ? "It may have been moved or deleted. Return to the list." : "Choose a file from the list — folders open in place."
          }
        />
      </div>
    )
  }
  if (selected.kind === "dir") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)]">
        <PreviewChrome onBack={onBack} />
        <EmptyState
          className="m-6 max-w-sm self-center border-0 bg-transparent py-12 sm:mt-16"
          title="Directory"
          description="Open it from the list."
        />
      </div>
    )
  }
  if (contentQuery.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)]" role="status" aria-busy="true">
        <span className="sr-only">Loading preview…</span>
        <PreviewChrome
          onBack={onBack}
          tall
          trailing={<PreviewActions selected={selected} onRequestAgent={onRequestAgent} apiBase={apiBase} />}
        >
          <div className="osc-skeleton h-4 w-40" />
        </PreviewChrome>
        <div className="flex-1 p-4">
          <div className="osc-skeleton h-full min-h-48 w-full" />
        </div>
      </div>
    )
  }
  if (contentQuery.error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)]">
        <PreviewChrome
          onBack={onBack}
          trailing={<PreviewActions selected={selected} onRequestAgent={onRequestAgent} apiBase={apiBase} />}
        />
        <ErrorState
          className="m-4 flex-1 border-0 py-12"
          title="Preview failed"
          description={`${(contentQuery.error as Error).message}. Retry, or return to the file list.`}
          action={
            <button type="button" className="osc-chip" onClick={() => void contentQuery.refetch()}>
              Retry preview
            </button>
          }
        />
      </div>
    )
  }
  const data = contentQuery.data
  if (!data) return null

  const downloadHref = `${apiBase}/raw?path=${encodeURIComponent(selected.path)}&download=1`
  const rawHref = `${apiBase}/raw?path=${encodeURIComponent(selected.path)}`

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)]">
      <PreviewChrome onBack={onBack} trailing={<PreviewActions selected={selected} onRequestAgent={onRequestAgent} apiBase={apiBase} />}>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-[var(--osc-text)]">{selected.name}</p>
          <p
            className="truncate font-mono text-[11px] text-[var(--osc-text-muted)]"
            title={`${selected.path}${selected.bytes !== undefined ? ` · ${formatBytes(selected.bytes)}` : ""}${selected.mime ? ` · ${selected.mime}` : ""}`}
          >
            <span className="sm:hidden">
              {selected.bytes !== undefined ? formatBytes(selected.bytes) : selected.mime || selected.path}
              {selected.bytes !== undefined && selected.mime ? ` · ${selected.mime}` : ""}
            </span>
            <span className="hidden sm:inline">
              {selected.path}
              {selected.bytes !== undefined ? ` · ${formatBytes(selected.bytes)}` : ""}
              {selected.mime ? ` · ${selected.mime}` : ""}
            </span>
          </p>
        </div>
      </PreviewChrome>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {mediaError ? (
          <ErrorState
            className="mx-auto max-w-md border-0 bg-transparent py-12"
            title="Media preview failed"
            description="Retry the inline preview, or download the original file."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="osc-chip" onClick={() => setMediaError(false)}>
                  Retry
                </button>
                <a href={downloadHref} className="osc-chip">
                  Download
                </a>
              </div>
            }
          />
        ) : data.preview === "image" ? (
          <img
            src={rawHref}
            alt={selected.name}
            onError={() => setMediaError(true)}
            className="mx-auto max-h-full max-w-full rounded-[var(--osc-radius-md)] object-contain shadow-[var(--osc-shadow)]"
          />
        ) : data.preview === "audio" ? (
          <audio
            aria-label={`Audio preview: ${selected.name}`}
            controls
            src={rawHref}
            onError={() => setMediaError(true)}
            className="w-full"
          />
        ) : data.preview === "video" ? (
          <video
            aria-label={`Video preview: ${selected.name}`}
            controls
            src={rawHref}
            onError={() => setMediaError(true)}
            className="mx-auto max-h-full max-w-full rounded-[var(--osc-radius-md)]"
          />
        ) : data.preview === "text" ? (
          data.truncated || data.text === null ? (
            <p className="text-sm text-[var(--osc-text-muted)]">Text too large to preview — use Download.</p>
          ) : (
            <pre className="overflow-auto rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--osc-text)] md:whitespace-pre md:break-normal">
              {data.text}
            </pre>
          )
        ) : (
          <p className="text-sm text-[var(--osc-text-muted)]">No inline preview for this type. Use Download.</p>
        )}
      </div>
    </div>
  )
}

export function FilesExplorer({
  onRequestAgent,
  apiBase = "/api/files",
  rootLabel = "Home",
  studioId = "files",
}: {
  onRequestAgent?: (path: string) => void
  apiBase?: string
  rootLabel?: string
  studioId?: string
}) {
  const normalizedApiBase = apiBase.replace(/\/$/, "")
  const [dirPath, setDirPath] = useState("")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [cursor, setCursor] = useState(0)
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listColumnRef = useRef<HTMLDivElement>(null)

  const treeQuery = useQuery({
    queryKey: ["files", normalizedApiBase, "tree", dirPath],
    queryFn: () => fetchJson<TreeResponse>(`${normalizedApiBase}/tree?path=${encodeURIComponent(dirPath)}`),
  })

  const entries = useMemo(() => {
    const all = treeQuery.data?.entries ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return all
    return all.filter((entry) => entry.name.toLowerCase().includes(q))
  }, [filter, treeQuery.data])

  const safeCursor = entries.length === 0 ? 0 : Math.min(cursor, entries.length - 1)

  const selected = useMemo(() => {
    if (!selectedPath || !treeQuery.data) return null
    return treeQuery.data.entries.find((e) => e.path === selectedPath) ?? null
  }, [selectedPath, treeQuery.data])

  const resetList = () => {
    setFilter("")
    setCursor(0)
    setSelectedPath(null)
  }

  const navigateDir = (next: string) => {
    setDirPath(next)
    resetList()
    queueMicrotask(() => filterRef.current?.focus())
  }

  const moveCursor = (next: number, focus = false) => {
    setCursor(next)
    queueMicrotask(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-index='${next}']`)
      row?.scrollIntoView({ block: "nearest" })
      if (focus) row?.focus({ preventScroll: true })
    })
  }

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "dir") {
      navigateDir(entry.path)
      return
    }
    setSelectedPath(entry.path)
  }

  const goUp = () => {
    const parent = parentPath(dirPath)
    navigateDir(parent ?? "")
  }

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (!listColumnRef.current?.contains(target)) return

    const tag = target.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
      if (event.key === "Escape" && filter) {
        event.preventDefault()
        setFilter("")
        listColumnRef.current.focus()
      }
      return
    }

    if (event.key === "/") {
      event.preventDefault()
      filterRef.current?.focus()
      filterRef.current?.select()
      return
    }

    if (event.key === "Escape") {
      if (filter) {
        event.preventDefault()
        setFilter("")
        return
      }
      if (selectedPath) {
        event.preventDefault()
        setSelectedPath(null)
      }
      return
    }

    if (event.key === "Backspace" && !filter && dirPath) {
      event.preventDefault()
      goUp()
      return
    }

    if (entries.length === 0) return

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault()
      moveCursor(Math.min(safeCursor + 1, entries.length - 1), true)
      return
    }
    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault()
      moveCursor(Math.max(safeCursor - 1, 0), true)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const entry = entries[safeCursor]
      if (entry) openEntry(entry)
      return
    }

    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      setFilter((value) => value + event.key)
      moveCursor(0)
      filterRef.current?.focus()
    }
  }

  const crumbs = dirPath ? dirPath.split("/").filter(Boolean) : []
  const showPreviewMobile = Boolean(selectedPath)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--osc-bg)]" data-studio={studioId}>
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-2 sm:h-10 sm:px-3">
        <button
          type="button"
          className="osc-icon-btn size-8 text-[var(--osc-text-muted)] disabled:opacity-40"
          disabled={!dirPath}
          onClick={goUp}
          aria-label="Go up one directory"
          title="Up"
        >
          <UpIcon />
        </button>
        <nav
          className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-contain whitespace-nowrap text-[12px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Breadcrumb"
          title={dirPath || rootLabel}
        >
          <button
            type="button"
            className={`max-w-[8rem] truncate rounded-[var(--osc-radius-sm)] px-1.5 py-1 font-medium transition-colors duration-[var(--osc-motion-duration)] hover:bg-[var(--osc-surface)] ${
              crumbs.length === 0 ? "text-[var(--osc-text)]" : "text-[var(--osc-text-muted)]"
            }`}
            onClick={() => navigateDir("")}
            aria-current={crumbs.length === 0 ? "location" : undefined}
          >
            {rootLabel}
          </button>
          {crumbs.map((part, index) => {
            const target = crumbs.slice(0, index + 1).join("/")
            const isLast = index === crumbs.length - 1
            return (
              <span key={target} className="flex min-w-0 items-center gap-0.5">
                <span className="shrink-0 text-[var(--osc-text-faint)]" aria-hidden>
                  /
                </span>
                <button
                  type="button"
                  className={`max-w-[10rem] truncate rounded-[var(--osc-radius-sm)] px-1.5 py-1 font-medium transition-colors duration-[var(--osc-motion-duration)] hover:bg-[var(--osc-surface)] ${
                    isLast ? "text-[var(--osc-text)]" : "text-[var(--osc-text-muted)]"
                  }`}
                  onClick={() => navigateDir(target)}
                  aria-current={isLast ? "location" : undefined}
                >
                  {part}
                </button>
              </span>
            )
          })}
        </nav>
        <button
          type="button"
          className="osc-icon-btn size-10 shrink-0 text-[var(--osc-text-muted)] sm:size-8"
          onClick={() => void treeQuery.refetch()}
          aria-label={treeQuery.isFetching ? "Refreshing files" : "Refresh files"}
          disabled={treeQuery.isFetching}
        >
          <RefreshIcon />
        </button>
        <span className="hidden shrink-0 font-mono text-[10px] tracking-wide text-[var(--osc-text-muted)] uppercase sm:inline">
          read-only
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          ref={listColumnRef}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className={`flex min-h-0 shrink-0 flex-col border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] outline-none md:w-72 md:border-r ${
            showPreviewMobile ? "hidden md:flex" : "flex-1 border-b md:flex-none md:border-b-0"
          }`}
        >
          <div className="border-b border-[var(--osc-border)] p-2">
            <label className="sr-only" htmlFor="files-filter">
              Filter files
            </label>
            <input
              id="files-filter"
              ref={filterRef}
              type="search"
              name="files-filter"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value)
                moveCursor(0)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault()
                  listColumnRef.current?.focus()
                  if (event.key === "ArrowDown") moveCursor(0, true)
                  if (event.key === "ArrowUp") moveCursor(Math.max(entries.length - 1, 0), true)
                }
              }}
              placeholder="Filter…  /"
              className="h-8 w-full rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg)] px-2.5 text-[12px] text-[var(--osc-text)] outline-none transition-[border-color,box-shadow] duration-[var(--osc-motion-duration)] placeholder:text-[var(--osc-text-faint)] focus:border-[var(--osc-border-strong)] focus-visible:shadow-[var(--osc-focus-ring)]"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            {treeQuery.isLoading && (
              <div className="space-y-1 p-2" role="status" aria-busy="true">
                <span className="sr-only">Loading…</span>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="osc-skeleton h-8 w-full rounded-[var(--osc-radius-sm)]" aria-hidden />
                ))}
              </div>
            )}
            {treeQuery.error && (
              <ErrorState
                className="m-3 border-0 py-8"
                title="Could not load files"
                description={`${(treeQuery.error as Error).message}. Check Studio Home and retry.`}
                action={
                  <button type="button" className="osc-chip" onClick={() => void treeQuery.refetch()}>
                    Retry
                  </button>
                }
              />
            )}
            {treeQuery.data && treeQuery.data.entries.length === 0 && (
              <EmptyState className="m-3 border-0 bg-transparent py-10" title="Empty directory" />
            )}
            {treeQuery.data && treeQuery.data.entries.length > 0 && entries.length === 0 && (
              <EmptyState
                className="m-3 border-0 bg-transparent py-10"
                title="No matches"
                description="Clear the filter or try another name."
                action={
                  <button type="button" className="osc-chip" onClick={() => setFilter("")}>
                    Clear filter
                  </button>
                }
              />
            )}
            {entries.length > 0 && (
              <ul ref={listRef} className="py-1" aria-label="Directory entries">
                {entries.map((entry, index) => {
                  const active = index === safeCursor
                  const selectedRow = selectedPath === entry.path
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        data-index={index}
                        data-active={active ? "true" : undefined}
                        aria-pressed={entry.kind === "file" ? selectedRow : undefined}
                        tabIndex={active ? 0 : -1}
                        className={`relative flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors duration-[var(--osc-motion-duration)] hover:bg-[var(--osc-surface-hover)] focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-[var(--osc-focus-ring)] ${
                          selectedRow ? "bg-[var(--osc-surface)] font-medium text-[var(--osc-text)]" : "text-[var(--osc-text)]"
                        }`}
                        onFocus={() => setCursor(index)}
                        onClick={() => {
                          moveCursor(index)
                          openEntry(entry)
                        }}
                      >
                        {selectedRow && (
                          <span
                            className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--osc-accent)]"
                            aria-hidden
                          />
                        )}
                        <span
                          className={`grid size-5 shrink-0 place-items-center ${
                            entry.kind === "dir" ? "text-[var(--osc-text-muted)]" : "text-[var(--osc-text-faint)]"
                          }`}
                        >
                          {entry.kind === "dir" ? <FolderIcon /> : <FileIcon />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        {entry.kind === "file" && (
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--osc-text-muted)]">
                            {formatBytes(entry.bytes)}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
        <div className={`min-h-0 min-w-0 flex-1 flex-col ${showPreviewMobile ? "flex" : "hidden md:flex"}`}>
          <PreviewPane
            key={selectedPath ?? "none"}
            selected={selected}
            selectedPath={selectedPath}
            onBack={selectedPath ? () => setSelectedPath(null) : undefined}
            onRequestAgent={onRequestAgent}
            apiBase={normalizedApiBase}
          />
        </div>
      </div>
    </div>
  )
}
