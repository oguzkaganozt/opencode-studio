import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Dialog } from "@ui/components/dialog"
import { artifactUrl, type DesignSummary, eventsUrl, listDesigns, readDesign, renderUrl, studioHref } from "./api"
import { type ClickInfo, type LoadPart, PART_COLORS, type SceneHandle } from "./assembly-types"

const AssemblyViewport = lazy(async () => {
  const module = await import("./assembly-viewport")
  return { default: module.AssemblyViewport }
})

function statusBadge(status: DesignSummary["buildStatus"]) {
  if (status === "built") return { label: "built", className: "text-[var(--osc-success)]" }
  if (status === "stale") return { label: "stale", className: "text-[var(--osc-warning)]" }
  return { label: "unbuilt", className: "text-[var(--osc-text-faint)]" }
}

const CAD_COMPACT_WIDTH = 960

function useCadSpace() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  // null = not measured yet → treat as compact to avoid docked-inspector flash
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = rootRef.current
    const shell = el?.closest(".studio-shell") ?? document.querySelector(".studio-shell")
    const read = () => setAgentOpen(shell?.getAttribute("data-agent-open") === "true")
    read()
    if (!shell) return
    const mo = new MutationObserver(read)
    mo.observe(shell, { attributes: true, attributeFilter: ["data-agent-open"] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      setWidth(next > 0 ? next : null)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const narrow = width === null || width < CAD_COMPACT_WIDTH
  return { rootRef, compact: agentOpen || narrow }
}

function ResourceRail({
  designs,
  selectedId,
  mode,
  onClose,
}: {
  designs: DesignSummary[]
  selectedId?: string
  mode: "dock" | "sheet"
  onClose?: () => void
}) {
  const body = (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--osc-border)] px-3">
        <span className="text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Designs</span>
        {onClose && (
          <button type="button" className="osc-icon-btn size-8 text-[var(--osc-text-muted)]" aria-label="Close designs" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <nav className="min-h-0 flex-1 overflow-auto overscroll-contain p-2" aria-label="Designs">
        {designs.length === 0 ? (
          <p className="cad-rail-empty">
            No designs yet.
            <span className="mt-1 block text-[12px] text-[var(--osc-text-faint)]">
              Build with the agent — finished designs show up here.
            </span>
          </p>
        ) : (
          designs.map((design) => {
            const active = design.id === selectedId
            const badge = statusBadge(design.buildStatus)
            return (
              <Link
                key={design.id}
                to={studioHref(`designs/${design.id}`)}
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
                className={`cad-rail-link ${
                  active ? "" : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
                onClick={onClose}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[var(--osc-text)]">{design.id}</span>
                  <span className={`mono text-[10px] uppercase tracking-wide ${badge.className}`}>{badge.label}</span>
                </div>
                <div className="mono mt-0.5 text-[10px] text-[var(--osc-text-faint)]">
                  {design.partCount} {design.partCount === 1 ? "part" : "parts"}
                </div>
              </Link>
            )
          })
        )}
      </nav>
    </>
  )

  if (mode === "sheet") {
    return (
      <aside className="cad-sheet cad-sheet-left flex w-[min(18rem,85vw)] flex-col border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow-md)]">
        {body}
      </aside>
    )
  }

  return (
    <aside className="hidden w-56 shrink-0 flex-col overflow-hidden border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] md:flex">
      {body}
    </aside>
  )
}

function Inspector({
  parts,
  highlights,
  renders,
  designId,
  mode,
  onClose,
  onTogglePart,
  onOpenRender,
}: {
  parts: Array<{ name: string; visible: boolean; color: number }>
  highlights: number
  renders: string[]
  designId?: string
  mode: "dock" | "sheet"
  onClose?: () => void
  onTogglePart: (index: number, visible: boolean) => void
  onOpenRender: (url: string, label: string) => void
}) {
  const body = (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--osc-border)] px-3">
        <span className="text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Parts</span>
        {onClose && (
          <button type="button" className="osc-icon-btn size-8 text-[var(--osc-text-muted)]" aria-label="Close inspector" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <ul className="max-h-40 min-h-0 flex-1 overflow-auto overscroll-contain p-2 md:max-h-none">
        {parts.length === 0 ? (
          <li className="cad-rail-empty">No parts loaded yet.</li>
        ) : (
          parts.map((part, index) => (
            <li key={`${part.name}-${index}`}>
              <label
                className={`cad-part-row hover:bg-[var(--osc-surface-hover)] ${
                  highlights === index ? "bg-[var(--osc-surface)] text-[var(--osc-accent)]" : "text-[var(--osc-text)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={part.visible}
                  aria-label={`Show ${part.name}`}
                  onChange={(event) => onTogglePart(index, event.target.checked)}
                  className="size-3.5 shrink-0 accent-[var(--osc-primary)]"
                />
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                  style={{ background: `#${part.color.toString(16).padStart(6, "0")}` }}
                  aria-hidden
                />
                <span className="min-w-0 truncate">{part.name}</span>
              </label>
            </li>
          ))
        )}
      </ul>
      <div className="border-y border-[var(--osc-border)] px-4 py-3 text-[11px] font-medium tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">
        Renders
      </div>
      <div className="grid max-h-40 min-h-0 grid-cols-2 gap-2 overflow-auto overscroll-contain p-2 md:max-h-none md:flex-1">
        {designId && renders.length > 0 ? (
          renders.map((file) => {
            const label = file.replace(/\.png$/, "")
            const url = renderUrl(designId, file)
            return (
              <button
                key={file}
                type="button"
                title={label}
                className="relative overflow-hidden rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-surface)] transition-[border-color,box-shadow] duration-[var(--osc-motion-duration)] hover:border-[var(--osc-border-strong)] hover:shadow-[var(--osc-shadow)] focus-visible:outline-none focus-visible:shadow-[var(--osc-focus-ring)]"
                onClick={() => onOpenRender(url, label)}
              >
                <img src={url} alt={label} loading="lazy" width={160} height={120} className="block h-auto w-full" />
                <span className="absolute inset-x-0 bottom-0 bg-[var(--cad-overlay-bg)] px-1 py-0.5 text-center font-mono text-[10px] text-[var(--cad-overlay-text)]">
                  {label}
                </span>
              </button>
            )
          })
        ) : (
          <p className="cad-rail-empty col-span-2 text-center text-[12px]">No renders yet</p>
        )}
      </div>
    </>
  )

  if (mode === "sheet") {
    return (
      <aside className="cad-sheet cad-sheet-right flex w-[min(18rem,85vw)] flex-col border-l border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow-md)]">
        {body}
      </aside>
    )
  }

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] md:w-60 md:border-t-0 md:border-l">
      {body}
    </aside>
  )
}

async function copyFeedback(text: string) {
  if (!navigator.clipboard) throw new Error("Clipboard API unavailable")
  await navigator.clipboard.writeText(text)
}

function useCadDesignEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const es = new EventSource(eventsUrl())
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as { type?: string; designId?: string }
        if (event.type === "designs-changed") {
          void queryClient.invalidateQueries({ queryKey: ["cad", "designs"] })
        }
        if (event.type === "design-changed" && event.designId) {
          void queryClient.invalidateQueries({ queryKey: ["cad", "designs"] })
          void queryClient.invalidateQueries({ queryKey: ["cad", "design", event.designId] })
        }
      } catch {
        // malformed event — ignore
      }
    }
    return () => es.close()
  }, [queryClient])
}

function DesignWorkspace({ designId }: { designId?: string }) {
  const navigate = useNavigate()
  const sceneRef = useRef<SceneHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { rootRef, compact } = useCadSpace()
  const [localParts, setLocalParts] = useState<LoadPart[] | null>(null)
  const [status, setStatus] = useState("idle")
  const [statusTone, setStatusTone] = useState<"ok" | "waiting" | "idle">("idle")
  const [click, setClick] = useState<ClickInfo | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [partUi, setPartUi] = useState<Array<{ name: string; visible: boolean; color: number }>>([])
  const [renderModal, setRenderModal] = useState<{ url: string; label: string } | null>(null)
  const [designsOpen, setDesignsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  useCadDesignEvents()

  // Agent open or narrow main → collapse docked rails; free canvas.
  useEffect(() => {
    if (compact) {
      setDesignsOpen(false)
      setInspectorOpen(false)
    }
  }, [compact])

  const designsQuery = useQuery({
    queryKey: ["cad", "designs"],
    queryFn: listDesigns,
  })

  const designQuery = useQuery({
    queryKey: ["cad", "design", designId],
    enabled: Boolean(designId) && !localParts,
    queryFn: () => readDesign(designId!),
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
      setStatus("loading…")
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
    setStatus("loading…")
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
      if (event.key !== "Escape") return
      if (renderModal) {
        event.preventDefault()
        event.stopPropagation()
        setRenderModal(null)
        return
      }
      if (designsOpen || inspectorOpen) {
        event.preventDefault()
        event.stopPropagation()
        setDesignsOpen(false)
        setInspectorOpen(false)
      }
    }
    document.addEventListener("dragover", onDragOver)
    document.addEventListener("dragleave", onDragLeave)
    document.addEventListener("drop", onDrop)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("dragover", onDragOver)
      document.removeEventListener("dragleave", onDragLeave)
      document.removeEventListener("drop", onDrop)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [loadFiles, renderModal, designsOpen, inspectorOpen])

  const info = click ? (
    <>
      <span className="font-medium text-[var(--osc-warning)]">{click.part}</span> pos:{" "}
      <span className="mono text-[var(--osc-warning)]">
        ({click.position.x}, {click.position.y}, {click.position.z})
      </span>{" "}
      normal:{" "}
      <span className="mono text-[var(--osc-warning)]">
        ({click.normal.x.toFixed(3)}, {click.normal.y.toFixed(3)}, {click.normal.z.toFixed(3)})
      </span>{" "}
      <span className="text-[var(--cad-overlay-faint)]">← {click.direction}</span>
      <div className="mt-0.5 text-[10px] text-[var(--cad-overlay-faint)]">Copy for clipboard · Prompt sends to agent</div>
    </>
  ) : serverParts ? (
    <>
      <span className="text-[var(--cad-overlay-muted)]">click a surface to inspect it</span>
      <div className="mt-0.5 text-[10px] text-[var(--cad-overlay-faint)]">orbit: drag · zoom: scroll · pan: right-drag</div>
    </>
  ) : null

  const statusClass =
    statusTone === "ok" ? "cad-status-ok" : statusTone === "waiting" ? "cad-status-wait" : "cad-status-idle"

  const dockRails = !compact
  const showDesignsSheet = compact && designsOpen
  const showInspectorSheet = compact && inspectorOpen

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col md:flex-row" data-cad-compact={compact ? "true" : "false"}>
      {dockRails && <ResourceRail designs={designs} selectedId={localParts ? undefined : designId} mode="dock" />}
      <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--osc-canvas-bg)]">
        <div className="cad-toolbar absolute top-3 left-3 z-10">
          {compact && (
            <>
              <button
                type="button"
                className="cad-chip"
                aria-pressed={designsOpen}
                aria-expanded={designsOpen}
                onClick={() => {
                  setDesignsOpen((v) => !v)
                  setInspectorOpen(false)
                }}
              >
                Designs
              </button>
              <button
                type="button"
                className="cad-chip"
                aria-pressed={inspectorOpen}
                aria-expanded={inspectorOpen}
                onClick={() => {
                  setInspectorOpen((v) => !v)
                  setDesignsOpen(false)
                }}
              >
                Parts
              </button>
            </>
          )}
          <label className="sr-only" htmlFor="design-select">
            Design
          </label>
          <select
            id="design-select"
            className="cad-select"
            value={localParts ? "" : (designId ?? "")}
            onChange={(event) => {
              setLocalParts(null)
              if (event.target.value) navigate(studioHref(`designs/${event.target.value}`))
            }}
          >
            <option value="">{designs.length ? "Select design…" : "No designs"}</option>
            {designs.map((design) => {
              const badge = statusBadge(design.buildStatus)
              return (
                <option key={design.id} value={design.id}>
                  {design.id} · {badge.label}
                </option>
              )
            })}
          </select>
          {(
            [
              ["Open", () => fileInputRef.current?.click()],
              [
                "Reload",
                () => {
                  if (localParts) {
                    setLocalParts([...localParts])
                    return
                  }
                  void designQuery.refetch()
                },
              ],
              ["Fit", () => sceneRef.current?.fitCamera()],
            ] as const
          ).map(([label, onClick]) => (
            <button key={label} type="button" className="cad-chip" onClick={onClick}>
              {label}
            </button>
          ))}
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
            className="cad-chip"
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
            className="cad-chip"
            disabled={!click}
            onClick={() => {
              if (!click) return
              const text = `The user clicked on "${click.part}" near position (${click.position.x}, ${click.position.y}, ${click.position.z}) where the surface faces (${click.normal.x}, ${click.normal.y}, ${click.normal.z}). Edit the geometry in this area.`
              requestAgentHandoff({ text, source: "cad" })
              showToast("Prompt ready in agent")
            }}
          >
            Prompt
          </button>
          <span className={`cad-chip border ${statusClass}`} aria-live="polite">
            {status}
          </span>
        </div>

        {!serverParts && (
          <div className="pointer-events-none absolute inset-0 z-[1] flex items-start justify-center px-4 pt-24 sm:items-center sm:pt-0">
            <div className="cad-empty" role="status">
              <p className="cad-empty__title">
                {designQuery.isError
                  ? "Could not load design"
                  : designId && designQuery.isLoading
                    ? "Loading design…"
                    : designId
                      ? "No build yet"
                      : "Load a design or .glb"}
              </p>
              <p className="cad-empty__body">
                {designQuery.isError
                  ? "Reload the design, or open a .glb to inspect geometry."
                  : designId && designQuery.isLoading
                    ? "Fetching assembly artifacts…"
                    : designId
                      ? "Build this design with the agent, then reload. You can also drop a .glb anytime."
                      : "Drop a file anywhere, use Open, or pick a design from the list."}
              </p>
              {!designQuery.isLoading && <p className="cad-empty__hint">orbit · zoom · pan</p>}
            </div>
          </div>
        )}

        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--osc-text-muted)]" role="status">
              Loading viewport…
            </div>
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

        {info && (
          <div className="cad-hud pointer-events-none absolute bottom-4 left-1/2 z-10 w-[calc(100%-1.25rem)] max-w-xl -translate-x-1/2 px-4 py-2.5 text-center text-[12px]">
            {info}
          </div>
        )}

        {dropActive && (
          <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-[var(--osc-radius-lg)] border-2 border-dashed border-[var(--osc-accent)] bg-black/75 text-[15px] font-medium text-[var(--osc-accent)]">
            drop .glb file(s)
          </div>
        )}
        {toast && (
          <div
            className="absolute top-14 left-1/2 z-50 -translate-x-1/2 rounded-[var(--osc-radius-md)] border border-[var(--osc-success)]/30 bg-[var(--osc-success-bg)] px-3 py-1.5 text-xs font-medium text-[var(--osc-success)]"
            role="status"
            aria-live="polite"
          >
            {toast}
          </div>
        )}

        {(showDesignsSheet || showInspectorSheet) && (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-[var(--osc-overlay)]"
            aria-label="Dismiss panel"
            onClick={() => {
              setDesignsOpen(false)
              setInspectorOpen(false)
            }}
          />
        )}
        {showDesignsSheet && (
          <div className="absolute inset-y-0 left-0 z-30 flex">
            <ResourceRail
              designs={designs}
              selectedId={localParts ? undefined : designId}
              mode="sheet"
              onClose={() => setDesignsOpen(false)}
            />
          </div>
        )}
        {showInspectorSheet && (
          <div className="absolute inset-y-0 right-0 z-30 flex">
            <Inspector
              parts={partUi}
              highlights={click?.partIndex ?? -1}
              renders={localParts ? [] : (designQuery.data?.renders ?? [])}
              designId={localParts ? undefined : designId}
              mode="sheet"
              onClose={() => setInspectorOpen(false)}
              onTogglePart={(index, visible) => {
                sceneRef.current?.setPartVisible(index, visible)
                setPartUi((current) => current.map((part, i) => (i === index ? { ...part, visible } : part)))
              }}
              onOpenRender={(url, label) => setRenderModal({ url, label })}
            />
          </div>
        )}
      </div>

      {dockRails && (
        <Inspector
          parts={partUi}
          highlights={click?.partIndex ?? -1}
          renders={localParts ? [] : (designQuery.data?.renders ?? [])}
          designId={localParts ? undefined : designId}
          mode="dock"
          onTogglePart={(index, visible) => {
            sceneRef.current?.setPartVisible(index, visible)
            setPartUi((current) => current.map((part, i) => (i === index ? { ...part, visible } : part)))
          }}
          onOpenRender={(url, label) => setRenderModal({ url, label })}
        />
      )}

      <Dialog
        open={Boolean(renderModal)}
        onClose={() => setRenderModal(null)}
        title="Render preview"
        overlayClassName="z-[200] bg-black/90"
        className="max-w-[min(90vw,56rem)] border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow-md)]"
      >
        <div className="relative p-3">
          <button
            type="button"
            data-autofocus
            className="osc-icon-btn absolute top-3 right-3 z-10 size-9 bg-[var(--osc-bg-elevated)] text-[var(--osc-text-muted)]"
            aria-label="Close render preview"
            onClick={() => setRenderModal(null)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {renderModal && (
            <img
              src={renderModal.url}
              alt={renderModal.label}
              className="mx-auto max-h-[85vh] max-w-full rounded-[var(--osc-radius-md)] border border-[var(--osc-border)]"
            />
          )}
        </div>
      </Dialog>
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
    <div
      className="flex min-h-0 flex-1 flex-col border-t border-[var(--osc-border)] bg-[var(--osc-bg)] text-[var(--osc-text)]"
      data-studio="cad"
    >
      <HashRedirect />
      <div className="sr-only">CAD Studio</div>
      <Routes>
        <Route index element={<Home />} />
        <Route path="designs/:id" element={<DesignRoute />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
      <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-3 text-[11px] text-[var(--osc-text-faint)] sm:px-4">
        <span className="cad-footer-meta">Read-only assembly inspection</span>
        <span className="cad-footer-note">Viewer does not mutate Data Root</span>
      </footer>
    </div>
  )
}
