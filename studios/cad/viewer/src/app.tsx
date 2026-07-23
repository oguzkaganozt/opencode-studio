import { useQuery } from "@tanstack/react-query"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router"
import { artifactUrl, type DesignSummary, fetchStudio, listDesigns, readDesign, renderUrl, studioHref } from "./api"
import { type ClickInfo, type LoadPart, PART_COLORS, type SceneHandle } from "./assembly-types"

const AssemblyViewport = lazy(async () => {
  const module = await import("./assembly-viewport")
  return { default: module.AssemblyViewport }
})

const POLL_MS = 2000

function statusBadge(status: DesignSummary["buildStatus"]) {
  if (status === "built") return { label: "built", className: "text-[var(--osc-success)]" }
  if (status === "stale") return { label: "stale", className: "text-[var(--osc-warning)]" }
  return { label: "unbuilt", className: "text-[var(--osc-text-faint)]" }
}

function StudioBar() {
  const studio = useQuery({ queryKey: ["cad", "studio"], queryFn: fetchStudio, staleTime: 60_000 })
  return (
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--osc-border)] px-3" data-studio="cad">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-semibold tracking-wide">CAD Studio</span>
        <span className="mono text-xs text-[var(--osc-text-muted)]">
          {studio.data ? `${studio.data.id}@${studio.data.packageVersion}` : "loading"}
        </span>
      </div>
      <span className="mono text-xs text-[var(--osc-text-faint)]">OSC {studio.data?.contractVersion ?? "…"}</span>
    </header>
  )
}

function ResourceRail({ designs, selectedId }: { designs: DesignSummary[]; selectedId?: string }) {
  return (
    <aside className="hidden w-56 shrink-0 overflow-auto border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] md:block">
      <div className="border-b border-[var(--osc-border)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">
        Designs
      </div>
      <nav className="flex flex-col p-1" aria-label="Designs">
        {designs.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[var(--osc-text-muted)]">No designs in Data Root.</p>
        ) : (
          designs.map((design) => {
            const active = design.id === selectedId
            const badge = statusBadge(design.buildStatus)
            return (
              <Link
                key={design.id}
                to={studioHref(`designs/${design.id}`)}
                className={`rounded-[var(--osc-radius-md)] px-2 py-1.5 text-sm ${
                  active
                    ? "bg-[var(--osc-surface)] text-[var(--osc-text)]"
                    : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{design.id}</span>
                  <span className={`mono text-[11px] ${badge.className}`}>{badge.label}</span>
                </div>
                <div className="mono text-[11px] text-[var(--osc-text-faint)]">{design.partCount} part(s)</div>
              </Link>
            )
          })
        )}
      </nav>
    </aside>
  )
}

function Inspector({
  parts,
  highlights,
  renders,
  designId,
  onTogglePart,
  onOpenRender,
}: {
  parts: Array<{ name: string; visible: boolean; color: number }>
  highlights: number
  renders: string[]
  designId?: string
  onTogglePart: (index: number, visible: boolean) => void
  onOpenRender: (url: string, label: string) => void
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] md:w-60 md:border-t-0 md:border-l">
      <div className="border-b border-[var(--osc-border)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">
        Parts
      </div>
      <ul className="max-h-40 flex-1 overflow-auto p-1 md:max-h-none">
        {parts.length === 0 ? (
          <li className="px-2 py-3 text-sm text-[var(--osc-text-muted)]">No parts loaded.</li>
        ) : (
          parts.map((part, index) => (
            <li key={`${part.name}-${index}`}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-[var(--osc-radius-md)] px-2 py-1.5 text-sm hover:bg-[var(--osc-surface-hover)] ${
                  highlights === index ? "text-[var(--osc-accent)]" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={part.visible}
                  aria-label={`Show ${part.name}`}
                  onChange={(event) => onTogglePart(index, event.target.checked)}
                />
                <span
                  className="inline-block size-3 shrink-0 rounded-full border border-[var(--osc-border)]"
                  style={{ background: `#${part.color.toString(16).padStart(6, "0")}` }}
                />
                <span className="truncate">{part.name}</span>
              </label>
            </li>
          ))
        )}
      </ul>
      <div className="border-y border-[var(--osc-border)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">
        Renders
      </div>
      <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-auto p-2 md:max-h-none md:flex-1">
        {designId && renders.length > 0 ? (
          renders.map((file) => {
            const label = file.replace(/\.png$/, "")
            const url = renderUrl(designId, file)
            return (
              <button
                key={file}
                type="button"
                title={label}
                className="relative overflow-hidden rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-surface)] hover:border-[var(--osc-accent)]"
                onClick={() => onOpenRender(url, label)}
              >
                <img src={url} alt={label} loading="lazy" className="block w-full" />
                <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[10px] text-[var(--osc-text)]">
                  {label}
                </span>
              </button>
            )
          })
        ) : (
          <p className="col-span-2 py-3 text-center text-xs text-[var(--osc-text-faint)]">no renders</p>
        )}
      </div>
    </aside>
  )
}

async function copyFeedback(text: string) {
  if (!navigator.clipboard) throw new Error("Clipboard API unavailable")
  await navigator.clipboard.writeText(text)
}

function DesignWorkspace({ designId }: { designId?: string }) {
  const navigate = useNavigate()
  const sceneRef = useRef<SceneHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [localParts, setLocalParts] = useState<LoadPart[] | null>(null)
  const [status, setStatus] = useState("idle")
  const [statusTone, setStatusTone] = useState<"ok" | "waiting" | "idle">("idle")
  const [click, setClick] = useState<ClickInfo | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [partUi, setPartUi] = useState<Array<{ name: string; visible: boolean; color: number }>>([])
  const [renderModal, setRenderModal] = useState<{ url: string; label: string } | null>(null)

  const designsQuery = useQuery({
    queryKey: ["cad", "designs"],
    queryFn: listDesigns,
    refetchInterval: POLL_MS,
  })

  const designQuery = useQuery({
    queryKey: ["cad", "design", designId],
    enabled: Boolean(designId) && !localParts,
    queryFn: () => readDesign(designId!),
    refetchInterval: POLL_MS,
  })

  const designs = designsQuery.data ?? []

  useEffect(() => {
    if (!designId && designs.length > 0 && !localParts) {
      navigate(studioHref(`designs/${designs[0]!.id}`), { replace: true })
    }
  }, [designId, designs, localParts, navigate])

  const serverParts = useMemo<LoadPart[] | null>(() => {
    if (localParts) return localParts
    const artifact = designQuery.data?.artifact
    if (!designId || !artifact) return null
    const withGlb = artifact.parts.filter((part) => part.files?.glb)
    if (withGlb.length === 0) return null
    return withGlb.map((part, index) => ({
      name: part.id,
      url: artifactUrl(designId, part.files.glb),
      color: PART_COLORS[index % PART_COLORS.length]!,
    }))
  }, [designId, designQuery.data, localParts])

  useEffect(() => {
    if (localParts) return
    if (!designId) {
      setStatus("idle")
      setStatusTone("idle")
      return
    }
    if (designQuery.isLoading) {
      setStatus("loading...")
      setStatusTone("waiting")
      return
    }
    if (designQuery.isError) {
      setStatus("load failed")
      setStatusTone("waiting")
      return
    }
    if (!designQuery.data?.artifact) {
      setStatus("no build yet")
      setStatusTone("waiting")
      setPartUi([])
    }
  }, [designId, designQuery.isLoading, designQuery.isError, designQuery.data, localParts])

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 1800)
  }

  const loadFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    setLocalParts((previous) => {
      for (const part of previous ?? []) {
        if (part.url.startsWith("blob:")) URL.revokeObjectURL(part.url)
      }
      return list.map((file, index) => ({
        name: file.name,
        url: URL.createObjectURL(file),
        color: PART_COLORS[index % PART_COLORS.length]!,
      }))
    })
    setClick(null)
    setStatus("loading...")
    setStatusTone("waiting")
  }, [])

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault()
      setDropActive(true)
    }
    const onDragLeave = () => setDropActive(false)
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      setDropActive(false)
      if (event.dataTransfer?.files.length) loadFiles(event.dataTransfer.files)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRenderModal(null)
    }
    document.addEventListener("dragover", onDragOver)
    document.addEventListener("dragleave", onDragLeave)
    document.addEventListener("drop", onDrop)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("dragover", onDragOver)
      document.removeEventListener("dragleave", onDragLeave)
      document.removeEventListener("drop", onDrop)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [loadFiles])

  const info = click ? (
    <>
      <span className="text-[var(--osc-accent)]">{click.part}</span> pos:{" "}
      <span className="mono text-[var(--osc-accent)]">
        ({click.position.x}, {click.position.y}, {click.position.z})
      </span>{" "}
      normal:{" "}
      <span className="mono text-[var(--osc-accent)]">
        ({click.normal.x.toFixed(3)}, {click.normal.y.toFixed(3)}, {click.normal.z.toFixed(3)})
      </span>{" "}
      <span className="text-[var(--osc-text-faint)]">← {click.direction}</span>
      <div className="mt-0.5 text-[10px] text-[var(--osc-text-faint)]">Copy or Prompt to paste into agent chat</div>
    </>
  ) : (
    <>
      <span className="text-[var(--osc-text-muted)]">
        {serverParts ? "click a surface to inspect it" : "select a design or open a .glb"}
      </span>
      <div className="mt-0.5 text-[10px] text-[var(--osc-text-faint)]">orbit: drag · zoom: scroll · pan: right-drag</div>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <ResourceRail designs={designs} selectedId={localParts ? undefined : designId} />
      <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--osc-canvas-bg)]">
        <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1">
          <label className="sr-only" htmlFor="design-select">
            Design
          </label>
          <select
            id="design-select"
            className="min-w-40 rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-black/75 px-2 py-1 text-xs"
            value={localParts ? "" : (designId ?? "")}
            onChange={(event) => {
              setLocalParts(null)
              if (event.target.value) navigate(studioHref(`designs/${event.target.value}`))
            }}
          >
            <option value="">{designs.length ? "— select design —" : "— no designs —"}</option>
            {designs.map((design) => {
              const badge = statusBadge(design.buildStatus)
              return (
                <option key={design.id} value={design.id}>
                  {badge.label === "built" ? "✓" : badge.label === "stale" ? "⚠" : "·"} {design.id}
                </option>
              )
            })}
          </select>
          <button
            type="button"
            className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-black/75 px-2 py-1 text-xs hover:border-[var(--osc-accent)]"
            onClick={() => fileInputRef.current?.click()}
          >
            Open
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) loadFiles(event.target.files)
              event.target.value = ""
            }}
          />
          <button
            type="button"
            className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-black/75 px-2 py-1 text-xs hover:border-[var(--osc-accent)]"
            onClick={() => {
              if (localParts) {
                setLocalParts([...localParts])
                return
              }
              void designQuery.refetch()
            }}
          >
            Reload
          </button>
          <button
            type="button"
            className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-black/75 px-2 py-1 text-xs hover:border-[var(--osc-accent)]"
            onClick={() => sceneRef.current?.fitCamera()}
          >
            Fit
          </button>
          <button
            type="button"
            className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-black/75 px-2 py-1 text-xs hover:border-[var(--osc-accent)]"
            disabled={!click}
            onClick={() => {
              if (!click) return
              const text = `clicked on ${click.part} at (${click.position.x}, ${click.position.y}, ${click.position.z}) normal (${click.normal.x}, ${click.normal.y}, ${click.normal.z})`
              void copyFeedback(text)
                .then(() => showToast("copied!"))
                .catch(() => showToast("clipboard unavailable"))
            }}
          >
            Copy
          </button>
          <button
            type="button"
            className="rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-black/75 px-2 py-1 text-xs hover:border-[var(--osc-accent)]"
            disabled={!click}
            onClick={() => {
              if (!click) return
              const text = `The user clicked on "${click.part}" near position (${click.position.x}, ${click.position.y}, ${click.position.z}) where the surface faces (${click.normal.x}, ${click.normal.y}, ${click.normal.z}). Edit the geometry in this area.`
              void copyFeedback(text)
                .then(() => showToast("feedback prompt copied!"))
                .catch(() => showToast("clipboard unavailable"))
            }}
          >
            Prompt
          </button>
          <span
            className={`rounded-[var(--osc-radius-md)] px-2 py-1 text-xs ${
              statusTone === "ok"
                ? "bg-[var(--osc-success-bg)] text-[var(--osc-success)]"
                : statusTone === "waiting"
                  ? "bg-[var(--osc-warning-bg)] text-[var(--osc-warning)]"
                  : "bg-[var(--osc-surface)] text-[var(--osc-text-muted)]"
            }`}
            aria-live="polite"
          >
            {status}
          </span>
        </div>

        {!serverParts && (
          <div className="pointer-events-none absolute top-1/2 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 text-center text-sm text-[var(--osc-text-faint)]">
            load a design or .glb file
            <span className="mt-1.5 block text-xs text-[var(--osc-text-faint)]">drop a file anywhere to open</span>
          </div>
        )}

        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--osc-text-muted)]">Loading viewport…</div>
          }
        >
          <AssemblyViewport
            parts={serverParts}
            sceneRef={sceneRef}
            onClick={setClick}
            onLoaded={(result) => {
              const scene = sceneRef.current
              setPartUi(
                (scene?.parts ?? []).map((part) => ({
                  name: part.name,
                  visible: part.visible,
                  color: part.origColor,
                })),
              )
              if (result.failed > 0) {
                setStatus(`${result.loaded} loaded, ${result.failed} failed`)
                setStatusTone("waiting")
              } else {
                setStatus(localParts ? `${result.loaded} file(s)` : `${result.loaded} part(s)`)
                setStatusTone("ok")
              }
            }}
          />
        </Suspense>

        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-[calc(100%-1.25rem)] max-w-xl -translate-x-1/2 rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-black/88 px-3.5 py-2 text-center text-xs">
          {info}
        </div>

        {dropActive && (
          <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--osc-accent)] bg-black/70 text-lg text-[var(--osc-accent)]">
            drop .glb file(s)
          </div>
        )}
        {toast && (
          <div
            className="absolute top-12 left-1/2 z-50 -translate-x-1/2 rounded-[var(--osc-radius-md)] bg-[var(--osc-success-bg)] px-3 py-1 text-xs text-[var(--osc-success)]"
            role="status"
            aria-live="polite"
          >
            {toast}
          </div>
        )}
      </div>

      <Inspector
        parts={partUi}
        highlights={click?.partIndex ?? -1}
        renders={localParts ? [] : (designQuery.data?.renders ?? [])}
        designId={localParts ? undefined : designId}
        onTogglePart={(index, visible) => {
          sceneRef.current?.setPartVisible(index, visible)
          setPartUi((current) => current.map((part, i) => (i === index ? { ...part, visible } : part)))
        }}
        onOpenRender={(url, label) => setRenderModal({ url, label })}
      />

      {renderModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/92"
          role="dialog"
          aria-modal="true"
          aria-label="Render preview"
          onClick={(event) => {
            if (event.target === event.currentTarget) setRenderModal(null)
          }}
        >
          <button
            type="button"
            className="absolute top-4 right-6 flex size-9 items-center justify-center rounded-full bg-black/60 text-[var(--osc-accent)]"
            aria-label="Close render preview"
            onClick={() => setRenderModal(null)}
          >
            ✕
          </button>
          <img src={renderModal.url} alt={renderModal.label} className="max-h-[90%] max-w-[90%] border border-[var(--osc-border)]" />
        </div>
      )}
    </div>
  )
}

function HashRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const match = location.hash.match(/^#design=(.+)$/)
    if (!match) return
    try {
      const id = decodeURIComponent(match[1]!)
      navigate(studioHref(`designs/${id}`), { replace: true })
    } catch {
      // ignore malformed hash
    }
  }, [navigate])
  return null
}

function Home() {
  return <DesignWorkspace />
}

function DesignRoute() {
  const { id } = useParams()
  if (!id) return <Navigate to=".." replace />
  return <DesignWorkspace designId={id} />
}

export function App() {
  return (
    <div className="flex h-full flex-col bg-[var(--osc-bg)] text-[var(--osc-text)]" data-studio="cad">
      <HashRedirect />
      <StudioBar />
      <Routes>
        <Route index element={<Home />} />
        <Route path="designs/:id" element={<DesignRoute />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--osc-border)] px-3 text-[11px] text-[var(--osc-text-faint)]">
        <span>Read-only assembly inspection</span>
        <span className="mono">Data Root unchanged by Viewer</span>
      </footer>
    </div>
  )
}
