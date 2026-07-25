import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { ArrowLeft, ArrowUpRight, ChevronRight, CircleAlert, Folder, FolderSearch, RefreshCw } from "lucide-react"
import { useDeferredValue, useEffect, useState } from "react"
import { Link, Route, Routes, useParams } from "react-router"
import {
  type Asset,
  type Folder as FolderEntry,
  getAsset,
  getHealth,
  getVersion,
  type LibraryScope,
  listAssets,
  type Modality,
  studioHref,
} from "./api"
import { MediaPreview, ModalityIcon } from "./components/media-preview"
import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { formatBytes, formatDate } from "./lib/utils"

const PAGE_SIZE = 24

function Shell() {
  const health = useQuery({ queryKey: ["media", "health"], queryFn: getHealth, retry: false })
  const version = useQuery({
    queryKey: ["media", "version"],
    queryFn: getVersion,
    retry: false,
    refetchInterval: 6 * 60 * 60 * 1000,
  })
  return (
    <div className="media-root flex min-h-0 flex-1 flex-col" data-studio="media">
      <div className="studio-subnav justify-between">
        <span className="px-1 text-[12px] text-[var(--osc-text-muted)]">Library · read-only</span>
        <div className="flex items-center gap-2 pr-1 text-[11px] tracking-wide text-[var(--osc-text-muted)] uppercase">
          <span
            className={`size-1.5 rounded-full ${health.isSuccess ? "bg-[var(--osc-success)]" : "bg-[var(--osc-error)]"}`}
            aria-hidden
          />
          {health.isSuccess ? "Live" : "Offline"}
        </div>
      </div>
      {version.data && (version.data.updateAvailable || version.data.restartRequired) && (
        <div
          className="flex flex-wrap items-center justify-center gap-3 border-b border-[var(--osc-border)] bg-[var(--osc-warning-bg)] px-4 py-2 text-[12px]"
          role="status"
        >
          <span>
            {version.data.restartRequired
              ? `Version ${version.data.installed} is installed; restart the companion to replace running ${version.data.running}.`
              : `Version ${version.data.latest} is available; running ${version.data.running}.`}
          </span>
          <code className="rounded bg-[var(--osc-bg-elevated)] px-2 py-0.5 font-mono text-[11px]">{version.data.updateCommand}</code>
        </div>
      )}
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6">
        <Routes>
          <Route index element={<LibraryPage />} />
          <Route path="assets/:ref" element={<AssetPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-4 text-[11px] text-[var(--osc-text-faint)]">
        <span>Read-only Library viewer</span>
        <span>Image · Audio · Video</span>
      </footer>
    </div>
  )
}

function LibraryPage() {
  const [scope, setScope] = useState<LibraryScope | undefined>()
  const [user, setUser] = useState("")
  const [userDefaulted, setUserDefaulted] = useState(false)
  const [modality, setModality] = useState<Modality | undefined>()
  const [filename, setFilename] = useState("")
  const [currentFolder, setCurrentFolder] = useState("")
  const deferredUser = useDeferredValue(user.trim())
  const deferredFilename = useDeferredValue(filename.trim())

  const folderMode = scope !== undefined && modality !== undefined && (scope !== "personal" || deferredUser !== "")
  const query = useInfiniteQuery({
    queryKey: ["media", "assets", scope, deferredUser, modality, deferredFilename, folderMode ? currentFolder : undefined],
    queryFn: ({ pageParam }) =>
      listAssets({
        scope,
        user: deferredUser || undefined,
        modality,
        filename: deferredFilename || undefined,
        folder: folderMode ? currentFolder : undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length * PAGE_SIZE : undefined),
  })
  const assets = query.data?.pages.flatMap((page) => page.assets) ?? []
  const folders = query.data?.pages.flatMap((page) => page.folders ?? []) ?? []

  useEffect(() => {
    if (userDefaulted || scope === "shared") return
    const fromApi = query.data?.pages[0]?.currentUser
    if (fromApi && !user) {
      setUser(fromApi)
      setUserDefaulted(true)
    }
  }, [query.data, user, userDefaulted, scope])

  const breadcrumb = currentFolder ? currentFolder.split("/").filter(Boolean) : []
  const navigateToFolder = (subfolder: string) => setCurrentFolder(subfolder)
  const navigateUp = () => {
    const parts = currentFolder.split("/").filter(Boolean)
    parts.pop()
    setCurrentFolder(parts.join("/"))
  }

  const field =
    "w-full border-0 bg-transparent p-0 text-[13px] text-[var(--osc-text)] outline-none placeholder:text-[var(--osc-text-faint)] disabled:text-[var(--osc-text-faint)]"

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Library index</p>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Media Library</h1>
        </div>
        <p className="text-[12px] text-[var(--osc-text-muted)]">
          <span className="font-semibold text-[var(--osc-text)] tabular-nums">{String(assets.length + folders.length).padStart(2, "0")}</span>{" "}
          loaded
        </p>
      </div>

      <section
        className="mb-4 grid gap-px overflow-hidden rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-border)] sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.9fr_1.2fr_auto]"
        aria-label="Library filters"
      >
        <label className="grid gap-1 bg-[var(--osc-bg-elevated)] px-3.5 py-2.5">
          <span className="text-[10px] tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Scope</span>
          <select
            className={field}
            value={scope ?? ""}
            onChange={(event) => {
              const nextScope = (event.target.value || undefined) as LibraryScope | undefined
              setScope(nextScope)
              if (nextScope === "shared") setUser("")
              setCurrentFolder("")
            }}
          >
            <option value="">Personal + shared</option>
            <option value="personal">Personal only</option>
            <option value="shared">Shared only</option>
          </select>
        </label>
        <label className="grid gap-1 bg-[var(--osc-bg-elevated)] px-3.5 py-2.5">
          <span className="text-[10px] tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">User</span>
          <input
            className={field}
            value={user}
            onChange={(event) => {
              setUser(event.target.value)
              setCurrentFolder("")
            }}
            placeholder="Any personal user"
            disabled={scope === "shared"}
            aria-label="Filter by personal user"
          />
        </label>
        <label className="grid gap-1 bg-[var(--osc-bg-elevated)] px-3.5 py-2.5">
          <span className="text-[10px] tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Format</span>
          <select
            className={field}
            value={modality ?? ""}
            onChange={(event) => {
              setModality((event.target.value || undefined) as Modality | undefined)
              setCurrentFolder("")
            }}
          >
            <option value="">All media</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
          </select>
        </label>
        <label className="grid gap-1 bg-[var(--osc-bg-elevated)] px-3.5 py-2.5">
          <span className="text-[10px] tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Filename</span>
          <input
            className={field}
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            placeholder="Contains…"
            aria-label="Filter by filename"
          />
        </label>
        <Button
          variant="outline"
          className="h-full min-h-[52px] rounded-none border-0! bg-[var(--osc-surface)]!"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={query.isFetching ? "spin" : undefined} size={14} />
          Refresh
        </Button>
      </section>

      {folderMode && (
        <section className="mb-4 flex flex-wrap items-center gap-2">
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label="Folder path">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface)] hover:text-[var(--osc-text)]"
              onClick={() => navigateToFolder("")}
            >
              <Folder size={14} /> Root
            </button>
            {breadcrumb.map((part, index) => {
              const subfolder = breadcrumb.slice(0, index + 1).join("/")
              return (
                <span key={subfolder} className="inline-flex items-center gap-1 text-[var(--osc-text-faint)]">
                  <ChevronRight size={13} />
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[12px] text-[var(--osc-text)] hover:bg-[var(--osc-surface)]"
                    onClick={() => navigateToFolder(subfolder)}
                  >
                    {part}
                  </button>
                </span>
              )
            })}
          </nav>
          {currentFolder && (
            <Button variant="ghost" onClick={navigateUp}>
              <ArrowLeft size={14} /> Up
            </Button>
          )}
        </section>
      )}

      <p className="mb-4 text-[12px] leading-relaxed text-[var(--osc-text-muted)]">
        Library changes happen through agent tools (<code className="rounded bg-[var(--osc-surface)] px-1">media_*</code>
        ). This companion only browses and previews.
      </p>

      <div className="mb-4 flex justify-between text-[11px] tracking-wide text-[var(--osc-text-faint)] uppercase">
        <span>Direct filesystem scan</span>
        <span>{query.isFetching ? "Scanning…" : "Manual refresh available"}</span>
      </div>

      {query.isLoading ? (
        <LoadingGrid />
      ) : query.isError && assets.length === 0 && folders.length === 0 ? (
        <ErrorState error={query.error} />
      ) : assets.length === 0 && folders.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Library assets">
            {folders.map((folder, index) => (
              <FolderCard key={folder.path} folder={folder} index={index} onClick={() => navigateToFolder(folder.subfolder)} />
            ))}
            {assets.map((asset, index) => (
              <AssetCard key={asset.ref} asset={asset} index={index} />
            ))}
          </section>
          {query.hasNextPage && <LoadMore loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />}
        </>
      )}
    </section>
  )
}

function FolderCard({ folder, index, onClick }: { folder: FolderEntry; index: number; onClick: () => void }) {
  return (
    <article className="overflow-hidden rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow)] transition-colors hover:border-[var(--osc-border-strong)]">
      <button type="button" className="block w-full text-left" onClick={onClick}>
        <div className="relative flex h-40 items-center justify-center border-b border-[var(--osc-border)] bg-[var(--osc-bg-subtle)] text-[var(--osc-accent)]">
          <Folder size={32} strokeWidth={1.25} />
          <span className="absolute top-2.5 left-2.5 grid size-6 place-items-center rounded-full bg-[var(--osc-bg-elevated)] font-mono text-[10px]">
            {String(index + 1).padStart(2, "0")}
          </span>
          <Badge className="absolute top-2.5 right-2.5">{folder.scope}</Badge>
        </div>
        <div className="p-3.5">
          <div className="flex items-center justify-between gap-2 text-[14px] font-medium">
            <span className="truncate">{folder.name}</span>
            <ChevronRight size={16} className="shrink-0 text-[var(--osc-text-faint)]" />
          </div>
          <p className="mt-1 text-[11px] text-[var(--osc-text-faint)]">{folder.user ? `users/${folder.user}` : "shared"}</p>
        </div>
      </button>
    </article>
  )
}

function AssetCard({ asset, index }: { asset: Asset; index: number }) {
  const filename = asset.path.split("/").at(-1) ?? asset.path
  return (
    <article className="overflow-hidden rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow)] transition-colors hover:border-[var(--osc-border-strong)]">
      <Link to={studioHref(`assets/${asset.ref}`)} className="block">
        <div className="relative h-40 overflow-hidden border-b border-[var(--osc-border)] bg-[var(--osc-canvas-bg)]">
          <MediaPreview asset={asset} compact />
          <span className="absolute top-2.5 left-2.5 grid size-6 place-items-center rounded-full bg-black/60 font-mono text-[10px] text-white">
            {String(index + 1).padStart(2, "0")}
          </span>
          <Badge className="absolute top-2.5 right-2.5">{asset.scope}</Badge>
        </div>
        <div className="p-3.5">
          <div className="flex items-center justify-between gap-2 text-[14px] font-medium">
            <span className="truncate">{filename}</span>
            <ArrowUpRight size={16} className="shrink-0 text-[var(--osc-text-faint)]" />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-[var(--osc-text-muted)]">
            <span className="inline-flex items-center gap-1">
              <ModalityIcon modality={asset.modality} />
              {asset.modality}
            </span>
            <span>{formatBytes(asset.bytes)}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-[var(--osc-text-faint)]">{asset.user ? `users/${asset.user}` : "shared"}</p>
        </div>
      </Link>
    </article>
  )
}

function AssetPage() {
  const { ref = "" } = useParams()
  const query = useQuery({ queryKey: ["media", "asset", ref], queryFn: () => getAsset(ref) })
  if (query.isLoading) return <PageLoading />
  if (query.isError || !query.data) return <ErrorState error={query.error} />
  const asset = query.data
  const filename = asset.path.split("/").at(-1) ?? asset.path
  return (
    <section>
      <Link
        to={studioHref()}
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] text-[var(--osc-text-muted)] hover:text-[var(--osc-text)]"
      >
        <ArrowLeft size={15} /> Back to Library
      </Link>
      <div className="grid overflow-hidden rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] lg:grid-cols-[1.4fr_0.6fr]">
        <div className="grid min-h-[360px] place-items-center bg-[var(--osc-canvas-bg)] lg:min-h-[480px]">
          <MediaPreview asset={asset} />
        </div>
        <aside className="border-t border-[var(--osc-border)] p-6 lg:border-t-0 lg:border-l">
          <p className="mb-1 text-[11px] font-medium tracking-[0.14em] text-[var(--osc-text-faint)] uppercase">Filesystem object</p>
          <h1 className="text-xl font-semibold tracking-tight break-words">{filename}</h1>
          <p className="mt-2 mb-6 break-all font-mono text-[11px] text-[var(--osc-text-muted)]">{asset.path}</p>
          <dl className="border-t border-[var(--osc-border)]">
            <Info label="Scope" value={asset.scope} />
            <Info label="User" value={asset.user ?? "shared Library"} />
            <Info label="Modality" value={asset.modality} />
            <Info label="MIME" value={asset.mime} />
            <Info label="Size" value={formatBytes(asset.bytes)} />
            <Info label="Modified" value={formatDate(asset.modifiedAt)} />
          </dl>
          <a
            className="mt-6 flex items-center justify-between border-b border-[var(--osc-text)] py-2.5 text-[12px] font-medium tracking-wide text-[var(--osc-text)] uppercase"
            href={asset.downloadUrl}
          >
            Download original <ArrowUpRight size={15} />
          </a>
        </aside>
      </div>
      <section className="mt-6 flex max-w-xl items-start gap-3 text-[13px] text-[var(--osc-text-muted)]">
        <FolderSearch size={18} className="mt-0.5 shrink-0 text-[var(--osc-accent)]" />
        <p>Read-only companion view. Import, rename, move, and delete through agent tools — not the browser.</p>
      </section>
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--osc-border)] py-2.5">
      <dt className="text-[11px] tracking-wide text-[var(--osc-text-faint)] uppercase">{label}</dt>
      <dd className="text-right text-[12px]">{value}</dd>
    </div>
  )
}

function LoadingGrid() {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-64 animate-pulse rounded-[var(--osc-radius-lg)] bg-[var(--osc-surface)]" />
      ))}
    </section>
  )
}

function PageLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-[12px] tracking-wide text-[var(--osc-text-muted)] uppercase">
      <RefreshCw className="spin" size={16} /> Loading filesystem record
    </div>
  )
}

function LoadMore({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-center py-8">
      <Button variant="outline" disabled={loading} onClick={onClick}>
        {loading ? "Scanning more files…" : "Load 24 more"}
      </Button>
    </div>
  )
}

function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-[var(--osc-radius-lg)] border border-dashed border-[var(--osc-border-strong)] px-6 py-12 text-center">
      <CircleAlert className="mb-3 text-[var(--osc-error)]" />
      <h2 className="mb-1 text-lg font-semibold">Could not read this Library record</h2>
      <p className="text-[13px] text-[var(--osc-text-muted)]">{error instanceof Error ? error.message : "Unknown API error"}</p>
    </div>
  )
}

function EmptyLibrary() {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-[var(--osc-radius-lg)] border border-dashed border-[var(--osc-border-strong)] px-6 py-12 text-center">
      <FolderSearch className="mb-3 text-[var(--osc-accent)]" />
      <h2 className="mb-1 text-lg font-semibold">The Library is empty</h2>
      <p className="max-w-sm text-[13px] text-[var(--osc-text-muted)]">
        Use agent tools to import, generate, or download media into the Library, then refresh this viewer.
      </p>
    </div>
  )
}

function NotFound() {
  return (
    <div className="grid min-h-[240px] place-items-center text-center">
      <h2 className="mb-2 text-lg font-semibold">Nothing at this address</h2>
      <Link to={studioHref()} className="text-[13px] text-[var(--osc-accent)] hover:underline">
        Return to Library
      </Link>
    </div>
  )
}

export function App() {
  return <Shell />
}
