import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { ArrowLeft, ArrowUpRight, ChevronRight, CircleAlert, Folder, FolderSearch, RefreshCw } from "lucide-react"
import { useDeferredValue, useState } from "react"
import { BrowserRouter, Link, Route, Routes, useParams } from "react-router"
import {
  type Asset,
  type Folder as FolderEntry,
  getAsset,
  getHealth,
  getVersion,
  type LibraryScope,
  listAssets,
  type Modality,
} from "./api"
import { MediaPreview, ModalityIcon } from "./components/media-preview"
import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { formatBytes, formatDate } from "./lib/utils"

const PAGE_SIZE = 24

function Shell() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, retry: false })
  const version = useQuery({ queryKey: ["version"], queryFn: getVersion, retry: false, refetchInterval: 6 * 60 * 60 * 1000 })
  return (
    <div className="studio-shell" data-studio="media">
      <div className="grain" aria-hidden="true" />
      <header className="topbar">
        <Link to="/" className="brand" aria-label="OpenCode Media Studio Library">
          <span className="brand-mark">OMS</span>
          <span>
            <strong>OpenCode</strong> Media Studio
          </span>
        </Link>
        <div className="topbar-title">Library / read-only companion</div>
        <div className="connection-status">
          <i className={health.isSuccess ? "online" : "offline"} />
          {health.isSuccess ? "Library live" : "Offline"}
        </div>
      </header>
      {version.data && (version.data.updateAvailable || version.data.restartRequired) && (
        <div className="update-banner" role="status">
          <span>
            {version.data.restartRequired
              ? `Version ${version.data.installed} is installed; restart the companion to replace running ${version.data.running}.`
              : `Version ${version.data.latest} is available; running ${version.data.running}.`}
          </span>
          <code>{version.data.updateCommand}</code>
        </div>
      )}
      <main>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/assets/:ref" element={<AssetPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer>
        <span>Read-only Library viewer</span>
        <span>Image / Audio / Video</span>
      </footer>
    </div>
  )
}

function LibraryPage() {
  const [scope, setScope] = useState<LibraryScope | undefined>()
  const [user, setUser] = useState("")
  const [modality, setModality] = useState<Modality | undefined>()
  const [filename, setFilename] = useState("")
  const [currentFolder, setCurrentFolder] = useState("")
  const deferredUser = useDeferredValue(user.trim())
  const deferredFilename = useDeferredValue(filename.trim())

  const folderMode = scope !== undefined && modality !== undefined && (scope !== "personal" || deferredUser !== "")
  const query = useInfiniteQuery({
    queryKey: ["assets", scope, deferredUser, modality, deferredFilename, folderMode ? currentFolder : undefined],
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

  const breadcrumb = currentFolder ? currentFolder.split("/").filter(Boolean) : []

  const navigateToFolder = (subfolder: string) => {
    setCurrentFolder(subfolder)
  }

  const navigateUp = () => {
    const parts = currentFolder.split("/").filter(Boolean)
    parts.pop()
    setCurrentFolder(parts.join("/"))
  }

  return (
    <section className="library-page reveal">
      <div className="library-header">
        <div>
          <p className="eyebrow">Library index</p>
          <h1>Media Library</h1>
        </div>
        <p className="library-count">
          <strong>{String(assets.length + folders.length).padStart(2, "0")}</strong>
          loaded
        </p>
      </div>

      <section className="filter-deck" aria-label="Library filters">
        <label>
          <span>Scope</span>
          <select
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
        <label>
          <span>User</span>
          <input
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
        <label>
          <span>Format</span>
          <select
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
        <label className="filename-filter">
          <span>Filename</span>
          <input
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            placeholder="Contains..."
            aria-label="Filter by filename"
          />
        </label>
        <Button variant="outline" className="refresh-library" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={query.isFetching ? "spin" : undefined} size={14} />
          Refresh
        </Button>
      </section>

      {folderMode && (
        <section className="folder-toolbar">
          <nav className="folder-breadcrumb" aria-label="Folder path">
            <button type="button" className="breadcrumb-root" onClick={() => navigateToFolder("")}>
              <Folder size={14} /> Root
            </button>
            {breadcrumb.map((part, index) => {
              const subfolder = breadcrumb.slice(0, index + 1).join("/")
              return (
                <span key={subfolder} className="breadcrumb-item">
                  <ChevronRight size={13} />
                  <button type="button" onClick={() => navigateToFolder(subfolder)}>
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

      <p className="operation-note viewer-note">
        Library changes happen through agent tools (<code>media_*</code>, generation, download). This companion only browses and previews.
      </p>

      <div className="library-ledger">
        <span>Direct filesystem scan</span>
        <span>{query.isFetching ? "Scanning current files" : "Manual refresh available"}</span>
      </div>

      {query.isLoading ? (
        <LoadingGrid />
      ) : query.isError && assets.length === 0 && folders.length === 0 ? (
        <ErrorState error={query.error} />
      ) : assets.length === 0 && folders.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <>
          <section className="asset-grid" aria-label="Library assets">
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
    <article className="asset-card folder-card" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <button type="button" className="asset-card-link folder-card-link" onClick={onClick}>
        <div className="asset-preview folder-preview">
          <Folder size={32} />
          <span className="asset-index">{String(index + 1).padStart(2, "0")}</span>
          <Badge className="scope-badge">{folder.scope}</Badge>
        </div>
        <div className="asset-card-body">
          <div className="asset-title">
            <span>{folder.name}</span>
            <ChevronRight size={16} />
          </div>
          <div className="asset-meta">
            <span>folder</span>
          </div>
          <p className="asset-path">{folder.user ? `users/${folder.user}` : "shared"}</p>
        </div>
      </button>
    </article>
  )
}

function AssetCard({ asset, index }: { asset: Asset; index: number }) {
  const filename = asset.path.split("/").at(-1) ?? asset.path
  return (
    <article className="asset-card" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <Link to={`/assets/${asset.ref}`} className="asset-card-link">
        <div className="asset-preview">
          <MediaPreview asset={asset} compact />
          <span className="asset-index">{String(index + 1).padStart(2, "0")}</span>
          <Badge className="scope-badge">{asset.scope}</Badge>
        </div>
        <div className="asset-card-body">
          <div className="asset-title">
            <span>{filename}</span>
            <ArrowUpRight size={16} />
          </div>
          <div className="asset-meta">
            <span>
              <ModalityIcon modality={asset.modality} />
              {asset.modality}
            </span>
            <span>{formatBytes(asset.bytes)}</span>
          </div>
          <p className="asset-path">{asset.user ? `users/${asset.user}` : "shared"}</p>
        </div>
      </Link>
    </article>
  )
}

function AssetPage() {
  const { ref = "" } = useParams()
  const query = useQuery({ queryKey: ["asset", ref], queryFn: () => getAsset(ref) })
  if (query.isLoading) return <PageLoading />
  if (query.isError || !query.data) return <ErrorState error={query.error} />
  const asset = query.data
  const filename = asset.path.split("/").at(-1) ?? asset.path
  return (
    <section className="detail-page reveal">
      <Link to="/" className="back-link">
        <ArrowLeft size={15} /> Back to Library
      </Link>
      <div className="detail-grid">
        <div className="detail-stage">
          <MediaPreview asset={asset} />
        </div>
        <aside className="detail-panel">
          <p className="eyebrow">Filesystem object</p>
          <h1>{filename}</h1>
          <p className="path-line">{asset.path}</p>
          <dl>
            <Info label="Scope" value={asset.scope} />
            <Info label="User" value={asset.user ?? "shared Library"} />
            <Info label="Modality" value={asset.modality} />
            <Info label="MIME" value={asset.mime} />
            <Info label="Size" value={formatBytes(asset.bytes)} />
            <Info label="Modified" value={formatDate(asset.modifiedAt)} />
          </dl>
          <a className="download-media" href={asset.downloadUrl}>
            Download original <ArrowUpRight size={15} />
          </a>
        </aside>
      </div>
      <section className="file-note">
        <FolderSearch size={18} />
        <p>Read-only companion view. Import, rename, move, and delete through agent tools — not the browser.</p>
      </section>
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function LoadingGrid() {
  return (
    <section className="asset-grid">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="asset-card skeleton" key={index} />
      ))}
    </section>
  )
}

function PageLoading() {
  return (
    <div className="page-loading">
      <RefreshCw className="spin" /> Loading filesystem record
    </div>
  )
}

function LoadMore({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <div className="load-more">
      <Button variant="outline" disabled={loading} onClick={onClick}>
        {loading ? "Scanning more files..." : "Load 24 more"}
      </Button>
    </div>
  )
}

function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="empty-state error-state">
      <CircleAlert />
      <h2>Could not read this Library record</h2>
      <p>{error instanceof Error ? error.message : "Unknown API error"}</p>
    </div>
  )
}

function EmptyLibrary() {
  return (
    <div className="empty-state">
      <FolderSearch />
      <h2>The Library is empty</h2>
      <p>Use agent tools to import, generate, or download media into the Library, then refresh this viewer.</p>
    </div>
  )
}

function NotFound() {
  return (
    <div className="empty-state">
      <h2>Nothing at this address</h2>
      <Link to="/">Return to Library</Link>
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}
