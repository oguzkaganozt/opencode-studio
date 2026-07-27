import { useQuery } from "@tanstack/react-query"
import { useMemo, useRef, useState } from "react"
import { EmptyState } from "./components/empty-state"
import { ErrorState } from "./components/error-state"

type FileEntry = {
  name: string
  path: string
  kind: "dir" | "file"
  bytes?: number
  modifiedAt?: string
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
  url?: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ?? body?.error ?? `Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function parentPath(current: string) {
  if (!current) return null
  const parts = current.split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function MobileBack({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null
  return (
    <button
      type="button"
      className="inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--osc-border)] px-2 text-[11px] font-medium hover:bg-[var(--osc-surface)] md:hidden"
      onClick={onBack}
    >
      ← List
    </button>
  )
}

function PreviewPane({ selected, selectedPath, onBack }: { selected: FileEntry | null; selectedPath: string | null; onBack?: () => void }) {
  const contentQuery = useQuery({
    queryKey: ["files", "content", selected?.path],
    enabled: Boolean(selected && selected.kind === "file"),
    queryFn: () => fetchJson<ContentResponse>(`/api/files/content?path=${encodeURIComponent(selected!.path)}`),
  })

  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {onBack && (
          <div className="border-b border-[var(--osc-border)] px-4 py-2">
            <MobileBack onBack={onBack} />
          </div>
        )}
        <EmptyState
          className="m-4 border-0 py-12"
          title={selectedPath ? "File unavailable" : "Select a file to preview"}
          description={selectedPath ? "It may have been moved or deleted. Return to the list." : undefined}
        />
      </div>
    )
  }
  if (selected.kind === "dir") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {onBack && (
          <div className="border-b border-[var(--osc-border)] px-4 py-2">
            <MobileBack onBack={onBack} />
          </div>
        )}
        <EmptyState className="m-4 border-0 py-12" title="Directory" description="Open it from the list." />
      </div>
    )
  }
  if (contentQuery.isLoading) {
    return <p className="p-6 text-sm text-[var(--osc-text-muted)]">Loading…</p>
  }
  if (contentQuery.error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {onBack && (
          <div className="border-b border-[var(--osc-border)] px-4 py-2">
            <MobileBack onBack={onBack} />
          </div>
        )}
        <ErrorState className="m-4 border-0 py-12" title="Preview failed" description={(contentQuery.error as Error).message} />
      </div>
    )
  }
  const data = contentQuery.data
  if (!data) return null

  const downloadHref = `/api/files/raw?path=${encodeURIComponent(selected.path)}&download=1`
  const rawHref = `/api/files/raw?path=${encodeURIComponent(selected.path)}`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--osc-border)] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MobileBack onBack={onBack} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{selected.name}</p>
            <p className="truncate text-[11px] text-[var(--osc-text-faint)]">
              {selected.path}
              {selected.bytes !== undefined ? ` · ${formatBytes(selected.bytes)}` : ""}
              {selected.mime ? ` · ${selected.mime}` : ""}
            </p>
          </div>
        </div>
        <a
          href={downloadHref}
          className="inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--osc-border)] px-2.5 text-[11px] font-medium hover:bg-[var(--osc-surface)]"
        >
          Download
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {data.preview === "image" && <img src={rawHref} alt={selected.name} className="max-h-full max-w-full object-contain" />}
        {data.preview === "audio" && <audio controls src={rawHref} className="w-full" />}
        {data.preview === "video" && <video controls src={rawHref} className="max-h-full max-w-full" />}
        {data.preview === "text" &&
          (data.truncated || data.text === null ? (
            <p className="text-sm text-[var(--osc-text-muted)]">Text too large to preview — use Download.</p>
          ) : (
            <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--osc-text)]">
              {data.text}
            </pre>
          ))}
        {data.preview === "none" && <p className="text-sm text-[var(--osc-text-muted)]">No inline preview for this type. Use Download.</p>}
      </div>
    </div>
  )
}

export function FilesExplorer() {
  const [dirPath, setDirPath] = useState("")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [cursor, setCursor] = useState(0)
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listColumnRef = useRef<HTMLDivElement>(null)

  const treeQuery = useQuery({
    queryKey: ["files", "tree", dirPath],
    queryFn: () => fetchJson<TreeResponse>(`/api/files/tree?path=${encodeURIComponent(dirPath)}`),
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
    queueMicrotask(() => listColumnRef.current?.focus())
  }

  const moveCursor = (next: number) => {
    setCursor(next)
    queueMicrotask(() => {
      listRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" })
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
      moveCursor(Math.min(safeCursor + 1, entries.length - 1))
      return
    }
    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault()
      moveCursor(Math.max(safeCursor - 1, 0))
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
    <div className="flex min-h-0 flex-1 flex-col" data-studio="files">
      <div className="flex items-center gap-2 border-b border-[var(--osc-border)] px-4 py-2">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[12px] font-medium hover:bg-[var(--osc-surface)] disabled:opacity-40"
          disabled={!dirPath}
          onClick={goUp}
        >
          ↑
        </button>
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[12px]" aria-label="Breadcrumb">
          <button type="button" className="rounded px-1.5 py-0.5 font-medium hover:bg-[var(--osc-surface)]" onClick={() => navigateDir("")}>
            workspace
          </button>
          {crumbs.map((part, index) => {
            const target = crumbs.slice(0, index + 1).join("/")
            return (
              <span key={target} className="flex items-center gap-1">
                <span className="text-[var(--osc-text-faint)]">/</span>
                <button
                  type="button"
                  className="max-w-[10rem] truncate rounded px-1.5 py-0.5 font-medium hover:bg-[var(--osc-surface)]"
                  onClick={() => navigateDir(target)}
                >
                  {part}
                </button>
              </span>
            )
          })}
        </nav>
        <span className="text-[11px] text-[var(--osc-text-faint)]">read-only</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          ref={listColumnRef}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className={`flex min-h-0 shrink-0 flex-col border-[var(--osc-border)] outline-none md:w-72 md:border-r ${
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
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value)
                moveCursor(0)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault()
                  listColumnRef.current?.focus()
                  if (event.key === "ArrowDown") moveCursor(Math.min(safeCursor + 1, Math.max(entries.length - 1, 0)))
                  if (event.key === "ArrowUp") moveCursor(Math.max(safeCursor - 1, 0))
                }
              }}
              placeholder="Filter…  /"
              className="h-8 w-full rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg)] px-2 text-[12px] text-[var(--osc-text)] outline-none placeholder:text-[var(--osc-text-faint)] focus:border-[var(--osc-border-strong)]"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {treeQuery.isLoading && <p className="p-4 text-sm text-[var(--osc-text-muted)]">Loading…</p>}
            {treeQuery.error && (
              <ErrorState className="m-3 border-0 py-8" title="Could not load files" description={(treeQuery.error as Error).message} />
            )}
            {treeQuery.data && treeQuery.data.entries.length === 0 && <EmptyState className="m-3 border-0 py-10" title="Empty directory" />}
            {treeQuery.data && treeQuery.data.entries.length > 0 && entries.length === 0 && (
              <EmptyState className="m-3 border-0 py-10" title="No matches" description="Clear the filter or try another name." />
            )}
            {entries.length > 0 && (
              <ul ref={listRef} className="py-1">
                {entries.map((entry, index) => {
                  const active = index === safeCursor
                  const selectedRow = selectedPath === entry.path
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        data-active={active ? "true" : undefined}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--osc-surface)] ${
                          selectedRow || active ? "bg-[var(--osc-surface)] font-medium" : ""
                        }`}
                        onClick={() => {
                          moveCursor(index)
                          openEntry(entry)
                        }}
                      >
                        <span className="w-4 shrink-0 text-[var(--osc-text-faint)]" aria-hidden>
                          {entry.kind === "dir" ? "▸" : "·"}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        {entry.kind === "file" && (
                          <span className="shrink-0 text-[10px] text-[var(--osc-text-faint)]">{formatBytes(entry.bytes)}</span>
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
          <PreviewPane selected={selected} selectedPath={selectedPath} onBack={selectedPath ? () => setSelectedPath(null) : undefined} />
        </div>
      </div>
    </div>
  )
}
