import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Badge } from "@ui/components/badge"
import { Dialog } from "@ui/components/dialog"
import { useFocusTrap } from "@ui/lib/focus-trap"
import { artifactUrl, type DesignSummary, eventsUrl, listDesigns, readDesign, renderUrl, studioHref } from "./api"
import {
  type ClickInfo,
  type InteractionMode,
  type LinkedPinPair,
  type LoadPart,
  MAX_PICKS,
  MAX_REGIONS,
  PART_COLORS,
  type RegionDraft,
  type RegionInfo,
  type RegionTool,
  type SceneHandle,
} from "./assembly-types"
import { collectPinPairMeasures, formatMm } from "./measure-geometry"

const AssemblyViewport = lazy(async () => {
  const module = await import("./assembly-viewport")
  return { default: module.AssemblyViewport }
})

function statusBadge(status: DesignSummary["buildStatus"]): { label: string; tone: "ok" | "warn" | "neutral" } {
  if (status === "built") return { label: "built", tone: "ok" }
  if (status === "stale") return { label: "stale", tone: "warn" }
  return { label: "unbuilt", tone: "neutral" }
}

const CAD_COMPACT_WIDTH = 960
const CAD_PHONE_WIDTH = 640

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8A5.5 5.5 0 1 1 11.2 3.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M11 2.5v2.75h2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function OpenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.5V3.75A1.25 1.25 0 0 1 3.75 2.5h2.4L7.5 4h4.75A1.25 1.25 0 0 1 13.5 5.25V6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.75 6.5h10.5l-.85 5.1a1.25 1.25 0 0 1-1.23 1.05H4.83a1.25 1.25 0 0 1-1.23-1.05L2.75 6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

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
  const phone = width === null || width < CAD_PHONE_WIDTH
  return { rootRef, compact: agentOpen || narrow, phone, width }
}

type SheetPlacement = "side-left" | "side-right" | "bottom"

function DesignsPanel({
  designs,
  selectedId,
  listStatus = "ready",
  listError,
  onRetry,
  onClose,
  onSelect,
  showClose,
}: {
  designs: DesignSummary[]
  selectedId?: string
  listStatus?: "loading" | "error" | "ready"
  listError?: string
  onRetry?: () => void
  onClose?: () => void
  onSelect: (id: string) => void
  showClose?: boolean
}) {
  return (
    <>
      <div className="cad-rail-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="cad-rail-label">Designs</span>
          {listStatus === "ready" && designs.length > 0 ? (
            <span className="cad-rail-meta" aria-hidden>
              {designs.length}
            </span>
          ) : null}
        </div>
        {showClose && onClose ? (
          <button type="button" data-autofocus className="osc-icon-btn size-10 text-[var(--osc-text-muted)]" aria-label="Close designs" onClick={onClose}>
            <CloseIcon />
          </button>
        ) : null}
      </div>
      <nav className="cad-rail-scroll min-h-0 flex-1 overflow-auto overscroll-contain p-2" aria-label="Designs">
        {listStatus === "loading" ? (
          <p className="cad-rail-empty" role="status">
            Loading designs…
          </p>
        ) : listStatus === "error" ? (
          <div className="cad-rail-empty" role="alert">
            <p>Could not load designs.</p>
            {listError ? <p className="mt-1 text-[12px] text-[var(--osc-text-faint)]">{listError}</p> : null}
            {onRetry ? (
              <button type="button" className="cad-rail-action mt-3" onClick={onRetry}>
                Retry
              </button>
            ) : null}
          </div>
        ) : designs.length === 0 ? (
          <p className="cad-rail-empty">
            No designs yet.
            <span className="mt-1.5 block text-[12px] text-[var(--osc-text-faint)]">Build with the agent — finished designs show up here.</span>
          </p>
        ) : (
          designs.map((design) => {
            const active = design.id === selectedId
            const badge = statusBadge(design.buildStatus)
            return (
              <button
                key={design.id}
                type="button"
                data-active={active ? "true" : undefined}
                aria-current={active ? "true" : undefined}
                className={`cad-rail-link ${
                  active ? "" : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
                onClick={() => onSelect(design.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-left font-medium text-[var(--osc-text)]">{design.id}</span>
                  <Badge tone={badge.tone} className="shrink-0">
                    {badge.label}
                  </Badge>
                </div>
                <div className="mono mt-0.5 text-left text-[10px] text-[var(--osc-text-faint)]">
                  {design.partCount} {design.partCount === 1 ? "part" : "parts"}
                </div>
              </button>
            )
          })
        )}
      </nav>
    </>
  )
}

function PartsPanel({
  parts,
  highlights,
  renders,
  designId,
  onClose,
  onTogglePart,
  onSetAllVisible,
  onOpenRender,
  showClose,
}: {
  parts: Array<{ name: string; visible: boolean; color: number }>
  highlights: number
  renders: string[]
  designId?: string
  onClose?: () => void
  onTogglePart: (index: number, visible: boolean) => void
  onSetAllVisible: (visible: boolean) => void
  onOpenRender: (url: string, label: string) => void
  showClose?: boolean
}) {
  const allVisible = parts.length > 0 && parts.every((p) => p.visible)
  const noneVisible = parts.length > 0 && parts.every((p) => !p.visible)

  return (
    <>
      <div className="cad-rail-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="cad-rail-label">Parts</span>
          {parts.length > 0 ? (
            <span className="cad-rail-meta" aria-hidden>
              {parts.filter((p) => p.visible).length}/{parts.length}
            </span>
          ) : null}
        </div>
        {showClose && onClose ? (
          <button type="button" data-autofocus className="osc-icon-btn size-10 text-[var(--osc-text-muted)]" aria-label="Close parts" onClick={onClose}>
            <CloseIcon />
          </button>
        ) : null}
      </div>
      {parts.length > 1 ? (
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-[var(--osc-border)] px-2 py-1.5">
          <button type="button" className="cad-ghost-btn" disabled={allVisible} onClick={() => onSetAllVisible(true)}>
            Show all
          </button>
          <button type="button" className="cad-ghost-btn" disabled={noneVisible} onClick={() => onSetAllVisible(false)}>
            Hide all
          </button>
        </div>
      ) : null}
      <ul className="cad-rail-scroll min-h-0 flex-1 overflow-auto overscroll-contain p-2">
        {parts.length === 0 ? (
          <li className="cad-rail-empty list-none">No parts loaded yet.</li>
        ) : (
          parts.map((part, index) => (
            <li key={`${part.name}-${index}`}>
              <button
                type="button"
                className={`cad-part-row hover:bg-[var(--osc-surface-hover)] ${
                  highlights === index ? "bg-[var(--osc-surface)] text-[var(--osc-accent)]" : "text-[var(--osc-text)]"
                }`}
                aria-pressed={part.visible}
                aria-label={`${part.visible ? "Hide" : "Show"} ${part.name}`}
                onClick={() => onTogglePart(index, !part.visible)}
              >
                <span className={`cad-part-check${part.visible ? " is-on" : ""}`} aria-hidden />
                <span
                  className="cad-part-swatch"
                  style={{ background: `#${part.color.toString(16).padStart(6, "0")}` }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-left">{part.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="cad-section-label">
        <span>Renders</span>
        {renders.length > 0 ? <span className="cad-rail-meta normal-case tracking-normal">{renders.length}</span> : null}
      </div>
      <div className="cad-rail-scroll grid min-h-0 grid-cols-2 gap-2 overflow-auto overscroll-contain p-2 md:flex-1">
        {designId && renders.length > 0 ? (
          renders.map((file) => {
            const label = file.replace(/\.png$/, "")
            const url = renderUrl(designId, file)
            return (
              <button key={file} type="button" title={label} className="cad-render-tile" onClick={() => onOpenRender(url, label)}>
                <img src={url} alt={label} loading="lazy" width={160} height={120} />
                <span className="cad-render-tile__label">{label}</span>
              </button>
            )
          })
        ) : (
          <p className="cad-rail-empty col-span-2">No renders yet</p>
        )}
      </div>
    </>
  )
}

function SheetShell({
  open,
  placement,
  label,
  onClose,
  children,
}: {
  open: boolean
  placement: SheetPlacement
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLElement>(null)
  useFocusTrap(open, panelRef, onClose)

  if (!open) return null

  const sideClass =
    placement === "side-left"
      ? "cad-sheet cad-sheet-left cad-sheet--side cad-sheet--left"
      : placement === "side-right"
        ? "cad-sheet cad-sheet-right cad-sheet--side cad-sheet--right"
        : "cad-sheet cad-sheet--bottom"

  return (
    <div className="cad-sheet-layer" role="presentation">
      <button type="button" className="cad-scrim" aria-label="Dismiss panel" onClick={onClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={label} className={`cad-rail ${sideClass}`}>
        {placement === "bottom" ? <div className="cad-sheet-handle" aria-hidden /> : null}
        {children}
      </aside>
    </div>
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
  const { rootRef, compact, phone } = useCadSpace()
  const [localParts, setLocalParts] = useState<LoadPart[] | null>(null)
  const [status, setStatus] = useState("idle")
  const [statusTone, setStatusTone] = useState<"ok" | "waiting" | "idle">("idle")
  const [picks, setPicks] = useState<ClickInfo[]>([])
  const [linkedPairs, setLinkedPairs] = useState<LinkedPinPair[]>([])
  const [linkArmed, setLinkArmed] = useState(false)
  const [linkFromId, setLinkFromId] = useState<string | null>(null)
  const [refArmed, setRefArmed] = useState(false)
  const [refTargetId, setRefTargetId] = useState<string | null>(null)
  const [regions, setRegions] = useState<RegionInfo[]>([])
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("pick")
  const [regionTool, setRegionTool] = useState<RegionTool>("rect")
  const [regionDraft, setRegionDraft] = useState<RegionDraft | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [partUi, setPartUi] = useState<Array<{ name: string; visible: boolean; color: number }>>([])
  const [renderModal, setRenderModal] = useState<{ url: string; label: string } | null>(null)
  const [designsOpen, setDesignsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  useCadDesignEvents()

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
  const selectedDesign = !localParts && designId ? designs.find((d) => d.id === designId) : undefined

  useEffect(() => {
    if (!designId && designs.length > 0 && !localParts) {
      navigate(studioHref(`designs/${designs[0]!.id}`), { replace: true })
    }
  }, [designId, designs, localParts, navigate])

  const designRevision = designQuery.data?.revision ?? null

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
      topoUrl: part.files.topo ? artifactUrl(designId, part.files.topo) : undefined,
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
  }

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    return () => {
      setLocalParts((previous) => {
        for (const part of previous ?? []) {
          if (part.url.startsWith("blob:")) URL.revokeObjectURL(part.url)
        }
        return null
      })
    }
  }, [])

  const loadFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".glb"))
    if (list.length === 0) {
      setToast("Only .glb files are supported")
      return
    }
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
    setPicks([])
    setRegions([])
    setRegionDraft(null)
    setStatus("loading…")
    setStatusTone("waiting")
  }, [])

  const clearLocalParts = useCallback(() => {
    setLocalParts((previous) => {
      for (const part of previous ?? []) {
        if (part.url.startsWith("blob:")) URL.revokeObjectURL(part.url)
      }
      return null
    })
    setPicks([])
    setRegions([])
    setRegionDraft(null)
    setPartUi([])
  }, [])

  const setAllPartsVisible = useCallback((visible: boolean) => {
    const scene = sceneRef.current
    if (!scene) return
    for (let i = 0; i < (scene.parts?.length ?? 0); i++) {
      scene.setPartVisible(i, visible)
    }
    setPartUi((current) => current.map((part) => ({ ...part, visible })))
  }, [])

  const closeSheets = useCallback(() => {
    setDesignsOpen(false)
    setInspectorOpen(false)
  }, [])

  const selectDesign = useCallback(
    (id: string) => {
      clearLocalParts()
      closeSheets()
      navigate(studioHref(`designs/${id}`))
    },
    [clearLocalParts, closeSheets, navigate],
  )

  useEffect(() => {
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
        closeSheets()
        return
      }
      if (regionDraft?.active) {
        event.preventDefault()
        event.stopPropagation()
        sceneRef.current?.cancelRegionStroke()
        setRegionDraft(null)
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [renderModal, designsOpen, inspectorOpen, closeSheets, regionDraft])

  const designsListStatus = designsQuery.isLoading ? "loading" : designsQuery.isError ? "error" : "ready"
  const designsListError = designsQuery.isError ? ((designsQuery.error as Error)?.message ?? "unknown error") : undefined

  const partCount = partUi.length
  const partsLabel =
    statusTone === "ok" && partCount > 0
      ? `${partCount} ${partCount === 1 ? "part" : "parts"}`
      : statusTone === "waiting"
        ? status
        : statusTone === "ok"
          ? "0 parts"
          : status

  const canOpenParts = Boolean(serverParts) || partCount > 0
  const dockRails = !compact
  const sheetOpen = compact && (designsOpen || inspectorOpen)
  const designsPlacement: SheetPlacement = phone ? "bottom" : "side-left"
  const partsPlacement: SheetPlacement = phone ? "bottom" : "side-right"

  const emptyTitle = designQuery.isError
    ? "Could not load design"
    : designId && designQuery.isLoading
      ? "Loading design…"
      : localParts
        ? "Loading files…"
        : designId
          ? "No build yet"
          : "Load a design or .glb"

  const emptyBody = designQuery.isError
    ? ((designQuery.error as Error)?.message ?? "Reload the design, or open a .glb.")
    : designId && designQuery.isLoading
      ? "Fetching assembly artifacts…"
      : designId
        ? "Build this design with the agent, then reload. You can also open a .glb anytime."
        : "Open a .glb, or pick a design from Designs."

  const showEmptyActions = !designQuery.isLoading && !localParts

  const openFilePicker = () => fileInputRef.current?.click()

  const reload = () => {
    if (localParts) {
      setLocalParts([...localParts])
      return
    }
    void designQuery.refetch()
  }

  const fitView = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scene = sceneRef.current
        if (!scene) return
        scene.resize()
        scene.fitCamera()
      })
    })
  }, [])

  const hasAnnotations = picks.length > 0 || regions.length > 0
  const pairMeasures = useMemo(() => collectPinPairMeasures(picks, linkedPairs), [picks, linkedPairs])
  const primaryPair = pairMeasures[0] ?? null

  const formatAnnotationText = (mode: "copy" | "prompt") => {
    if (!hasAnnotations) return ""
    const designLine = designId
      ? `design=${designId}${designRevision ? ` revision=${designRevision.slice(0, 12)}` : ""}`
      : ""
    const pointLines = picks.map((pick, index) => {
      const face =
        pick.faceId !== null ? `face=${pick.faceId}${pick.faceType ? ` (${pick.faceType})` : ""}` : "face=unknown"
      const point = `point_mm=(${pick.position.x}, ${pick.position.y}, ${pick.position.z})`
      const normal = `normal=(${pick.normal.x}, ${pick.normal.y}, ${pick.normal.z})`
      const snap = pick.snap ?? "free"
      const quality = pick.quality ?? "mesh-approx"
      const head = `  ${index + 1}) part=${pick.part} ${face} ${point} ${normal} direction=${pick.direction} snap=${snap} quality=${quality}`
      if (!pick.offset) return head
      const o = pick.offset
      return `${head}\n     offset_mm=${formatMm(o.distance_mm, 2)} ref=${o.ref} quality=${o.quality} edge=(${o.a_mm.x},${o.a_mm.y},${o.a_mm.z})-(${o.b_mm.x},${o.b_mm.y},${o.b_mm.z})`
    })
    const regionLines = regions.map((region, index) => {
      const kind = region.kind ?? "freehand"
      const head = `  ${index + 1}) part=${region.part} face=${region.faceId}${region.faceType ? ` type=${region.faceType}` : ""} kind=${kind} approximation=${region.approximation}`
      const sizeLine = region.size
        ? `     size_mm=width=${formatMm(region.size.width_mm, 1)} height=${formatMm(region.size.height_mm, 1)} quality=${region.size.quality} frame=${region.size.frame}`
        : null
      const normal = `     normal=(${region.normal.x}, ${region.normal.y}, ${region.normal.z})`
      const centroid = `     centroid_mm=(${region.centroid.x}, ${region.centroid.y}, ${region.centroid.z})`
      const boundary = `     boundary_mm=[${region.boundary.map((p) => `(${p.x},${p.y},${p.z})`).join(", ")}]`
      const planeLines: string[] = []
      if (region.plane) {
        const p = region.plane
        planeLines.push(
          `     plane_origin_mm=(${p.origin.x}, ${p.origin.y}, ${p.origin.z})`,
          `     plane_x=(${p.xAxis.x}, ${p.xAxis.y}, ${p.xAxis.z}) plane_y=(${p.yAxis.x}, ${p.yAxis.y}, ${p.yAxis.z})`,
          `     boundary2d_mm=[${p.boundary2d.map((q) => `(${q.u},${q.v})`).join(", ")}]`,
        )
      }
      return [head, sizeLine, normal, centroid, ...planeLines, boundary].filter(Boolean).join("\n")
    })
    const measureLines = pairMeasures.map(
      (pair, i) =>
        `  ${i + 1}) kind=pin_distance from_point=${pair.fromIndex} to_point=${pair.toIndex} distance_mm=${formatMm(pair.distance_mm, 2)} quality=${pair.quality} source=${pair.source}`,
    )

    const blocks: string[] = []
    if (designLine) blocks.push(designLine)
    if (mode === "prompt") {
      const measureNote = measureLines.length > 0 ? `, ${measureLines.length} measure(s)` : ""
      blocks.push(
        `User marked annotations in the CAD viewer (${picks.length} point(s), ${regions.length} region(s)${measureNote}).`,
      )
    }
    if (picks.length > 0) blocks.push(`points (${picks.length}):`, ...pointLines)
    if (measureLines.length > 0) blocks.push(`measures (${measureLines.length}):`, ...measureLines)
    if (regions.length > 0) blocks.push(`regions (${regions.length}):`, ...regionLines)
    if (mode === "prompt") {
      const partNames = [...new Set([...picks.map((p) => p.part), ...regions.map((r) => r.part)])]
      const stepHint =
        designId && partNames.length > 0
          ? ` Prefer STEP under step/ for: ${partNames.map((p) => `${p}.step`).join(", ")} (design ${designId}).`
          : ""
      blocks.push(
        `Points = locations; regions = face zones; measures = viewer working distances (linked pairs and/or last pin pair). Working dimensions are intent only — verify on STEP with build123d measure/compare before manufacturing claims. Map face ids on STEP, edit part sources, then design_build.${stepHint}`,
      )
    }
    return blocks.join("\n")
  }

  const copyClick = () => {
    if (!hasAnnotations) return
    void copyFeedback(formatAnnotationText("copy"))
      .then(() => showToast("Copied"))
      .catch(() => showToast("Clipboard unavailable"))
  }

  const promptClick = () => {
    if (!hasAnnotations) {
      showToast(interactionMode === "region" ? "Draw a region first" : "Tap a surface first")
      return
    }
    requestAgentHandoff({ text: formatAnnotationText("prompt"), source: "cad", open: true, copyFallback: true })
    showToast("Opened in agent")
  }

  const clearModeAnnotations = () => {
    if (interactionMode === "pick") {
      sceneRef.current?.clearPicks()
      setPicks([])
      setLinkedPairs([])
      setLinkArmed(false)
      setLinkFromId(null)
      setRefArmed(false)
      setRefTargetId(null)
    } else {
      sceneRef.current?.clearRegions()
      sceneRef.current?.cancelRegionStroke()
      setRegions([])
      setRegionDraft(null)
    }
  }

  const setMode = (mode: InteractionMode) => {
    setInteractionMode(mode)
    sceneRef.current?.setInteractionMode(mode)
    if (mode !== "pick") {
      setLinkArmed(false)
      setLinkFromId(null)
      setRefArmed(false)
      setRefTargetId(null)
    }
  }

  const toggleLink = () => {
    const next = !linkArmed
    setLinkArmed(next)
    if (!next) setLinkFromId(null)
    if (next) {
      setRefArmed(false)
      setRefTargetId(null)
      sceneRef.current?.setRefArmed(false)
    }
    sceneRef.current?.setLinkArmed(next)
  }

  const toggleRef = () => {
    const next = !refArmed
    setRefArmed(next)
    if (!next) setRefTargetId(null)
    if (next) {
      setLinkArmed(false)
      setLinkFromId(null)
      sceneRef.current?.setLinkArmed(false)
    }
    sceneRef.current?.setRefArmed(next)
  }

  const setTool = (tool: RegionTool) => {
    setRegionTool(tool)
    sceneRef.current?.setRegionTool(tool)
  }

  const lastPick = picks.length > 0 ? picks[picks.length - 1]! : null
  const lastRegion = regions.length > 0 ? regions[regions.length - 1]! : null
  const drawingRegion = Boolean(regionDraft?.active && (regionDraft.pointCount > 0 || regionDraft.faceId !== null))
  const drawingRect =
    drawingRegion &&
    (regionDraft?.tool === "rect" || regionTool === "rect") &&
    regionDraft?.width_mm != null &&
    regionDraft?.height_mm != null

  const toggleDesigns = () => {
    setDesignsOpen((v) => !v)
    setInspectorOpen(false)
  }

  const toggleParts = () => {
    setInspectorOpen((v) => !v)
    setDesignsOpen(false)
  }

  const designControlLabel = localParts ? "Local GLB" : (selectedDesign?.id ?? (designs.length ? "Designs" : "No designs"))

  const statusClass =
    statusTone === "ok" ? "cad-status-ok" : statusTone === "waiting" ? "cad-status-wait" : "cad-status-idle"

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 flex-col md:flex-row"
      data-cad-compact={compact ? "true" : "false"}
      data-cad-phone={phone ? "true" : "false"}
    >
      {dockRails && (
        <aside className="cad-rail hidden w-56 shrink-0 border-r border-[var(--osc-border)] md:flex">
          <DesignsPanel
            designs={designs}
            selectedId={localParts ? undefined : designId}
            listStatus={designsListStatus}
            listError={designsListError}
            onRetry={() => void designsQuery.refetch()}
            onSelect={selectDesign}
          />
        </aside>
      )}

      <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--osc-canvas-bg)]">
        {/* Canvas + chrome only — sheets live as siblings so inert never blocks them */}
        <div
          className="absolute inset-0"
          inert={sheetOpen ? true : undefined}
          onDragOver={(event) => {
            event.preventDefault()
            setDropActive(true)
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDropActive(false)
            if (event.dataTransfer?.files.length) loadFiles(event.dataTransfer.files)
          }}
        >
          <div className="cad-toolbar absolute top-3 left-3 z-10" role="toolbar" aria-label="CAD viewer">
            {compact ? (
              <button
                type="button"
                className={`cad-design-id${localParts ? " cad-design-id--local" : ""}`}
                aria-pressed={designsOpen}
                aria-expanded={designsOpen}
                aria-label={localParts ? "Local files — clear or pick a design" : `Design ${designControlLabel}`}
                title={localParts ? "Clear local · pick a design" : "Change design"}
                onClick={() => {
                  if (localParts) clearLocalParts()
                  toggleDesigns()
                }}
              >
                {designControlLabel}
              </button>
            ) : localParts ? (
              <button type="button" className="cad-design-id cad-design-id--local" onClick={clearLocalParts} title="Clear local GLB">
                Local GLB
              </button>
            ) : selectedDesign ? (
              <span className="cad-design-id" title={selectedDesign.id}>
                {selectedDesign.id}
              </span>
            ) : null}

            {compact ? (
              <button
                type="button"
                className={`cad-status-btn ${statusClass}`}
                aria-pressed={inspectorOpen}
                aria-expanded={inspectorOpen}
                aria-label={canOpenParts ? `Parts, ${partsLabel}` : partsLabel}
                disabled={statusTone === "waiting" && !canOpenParts}
                onClick={toggleParts}
              >
                {partsLabel}
              </button>
            ) : (
              <span className={`cad-status ${statusClass}`} aria-live="polite">
                {partsLabel}
              </span>
            )}

            <span className="cad-sep" aria-hidden />

            <span className="cad-seg" role="group" aria-label="Annotation tool">
              <button
                type="button"
                className="cad-chip"
                aria-pressed={interactionMode === "pick"}
                onClick={() => setMode("pick")}
              >
                Pick
              </button>
              <button
                type="button"
                className="cad-chip"
                aria-pressed={interactionMode === "region"}
                onClick={() => setMode("region")}
              >
                Region
              </button>
            </span>

            {interactionMode === "region" ? (
              <span className="cad-seg" role="group" aria-label="Region shape">
                <button
                  type="button"
                  className="cad-chip"
                  aria-pressed={regionTool === "rect"}
                  onClick={() => setTool("rect")}
                >
                  Rect
                </button>
                <button
                  type="button"
                  className="cad-chip"
                  aria-pressed={regionTool === "freehand"}
                  onClick={() => setTool("freehand")}
                >
                  Free
                </button>
              </span>
            ) : null}

            <button type="button" className="cad-chip" disabled={!serverParts} onClick={fitView} aria-label="Fit view">
              Fit
            </button>
            <button type="button" className="cad-chip cad-chip--icon" onClick={reload} aria-label="Reload">
              <ReloadIcon />
            </button>
            <button type="button" className="cad-chip cad-chip--icon" onClick={openFilePicker} aria-label="Open GLB file">
              <OpenIcon />
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
          </div>

          {!serverParts && (
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-start justify-center px-4 pt-28 sm:items-center sm:pt-0">
              <div className="cad-empty" role={designQuery.isError ? "alert" : "status"}>
                <p className="cad-empty__title">{emptyTitle}</p>
                <p className="cad-empty__body">{emptyBody}</p>
                {!designQuery.isLoading && !designQuery.isError && !localParts ? (
                  <p className="cad-empty__hint">orbit · zoom · pan</p>
                ) : null}
                {showEmptyActions ? (
                  <div className="cad-empty__actions">
                    {designQuery.isError ? (
                      <button type="button" className="cad-chip" onClick={() => void designQuery.refetch()}>
                        Retry
                      </button>
                    ) : null}
                    <button type="button" className="cad-chip cad-chip--accent" onClick={openFilePicker}>
                      Open .glb
                    </button>
                    {compact && designs.length > 0 ? (
                      <button
                        type="button"
                        className="cad-chip"
                        onClick={() => {
                          setDesignsOpen(true)
                          setInspectorOpen(false)
                        }}
                      >
                        Designs
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <Suspense
            fallback={
              <div className="cad-viewport-loading" role="status">
                <div className="cad-skeleton" aria-hidden />
                <span>Loading viewport…</span>
              </div>
            }
          >
            <AssemblyViewport
              parts={serverParts}
              interactionMode={interactionMode}
              regionTool={regionTool}
              linkArmed={linkArmed}
              refArmed={refArmed}
              sceneRef={sceneRef}
              onPicksChange={setPicks}
              onLinkedPairsChange={(pairs, meta) => {
                setLinkedPairs(pairs)
                setLinkArmed(meta.armed)
                setLinkFromId(meta.fromId)
              }}
              onRefChange={(meta) => {
                setRefArmed(meta.armed)
                setRefTargetId(meta.targetId)
              }}
              onRegionsChange={setRegions}
              onRegionDraftChange={setRegionDraft}
              onMessage={showToast}
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

          {!sheetOpen && (hasAnnotations || drawingRegion || serverParts) ? (
            <div
              className={`cad-hud absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-10 w-[calc(100%-1.25rem)] max-w-xl -translate-x-1/2 px-3 py-2.5 ${hasAnnotations || drawingRegion ? "" : "pointer-events-none"}`}
            >
              {drawingRegion ? (
                <>
                  <div className="cad-hud__primary text-center">
                    <span className="font-medium text-[var(--osc-warning)]">
                      {regionDraft?.part ?? "face"}
                      {regionDraft?.faceId !== null && regionDraft?.faceId !== undefined
                        ? ` · face ${regionDraft.faceId}`
                        : ""}
                    </span>
                    {drawingRect ? (
                      <span className="font-medium text-[var(--osc-warning)]">
                        {" "}
                        · W={formatMm(regionDraft!.width_mm!, 1)} H={formatMm(regionDraft!.height_mm!, 1)} mm
                      </span>
                    ) : (
                      <span className="text-[var(--cad-overlay-muted)]"> · drawing…</span>
                    )}
                  </div>
                  <div className="cad-hud__hint text-center">
                    {drawingRect || regionTool === "rect"
                      ? "Drag opposite corner · lift to keep · 2-finger cancels"
                      : "Loop near start to keep (auto-closes) · open lift discards"}
                  </div>
                </>
              ) : hasAnnotations ? (
                <>
                  <div className="cad-hud__primary text-center">
                    {picks.length > 0 ? (
                      <span className="font-medium text-[var(--osc-warning)]">
                        {picks.length} pin{picks.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {picks.length > 0 && regions.length > 0 ? (
                      <span className="text-[var(--cad-overlay-muted)]"> · </span>
                    ) : null}
                    {regions.length > 0 ? (
                      <span className="font-medium text-[var(--osc-warning)]">
                        {regions.length} region{regions.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {lastPick && interactionMode === "pick" ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">{lastPick.part}</span>
                        {lastPick.faceId !== null ? (
                          <>
                            <span className="text-[var(--cad-overlay-muted)]"> · </span>
                            <span className="font-medium text-[var(--osc-warning)]">face {lastPick.faceId}</span>
                          </>
                        ) : null}
                        {lastPick.snap && lastPick.snap !== "free" ? (
                          <>
                            <span className="text-[var(--cad-overlay-muted)]"> · </span>
                            <span className="font-medium text-[var(--osc-warning)]">snap={lastPick.snap}</span>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {lastRegion && interactionMode === "region" ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">
                          {lastRegion.part} · face {lastRegion.faceId}
                          {lastRegion.kind === "rect" && lastRegion.size
                            ? ` · ${formatMm(lastRegion.size.width_mm, 1)}×${formatMm(lastRegion.size.height_mm, 1)}`
                            : ""}
                        </span>
                      </>
                    ) : null}
                    {primaryPair ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">
                          Δ{primaryPair.source === "linked" ? "" : " last"}=
                          {formatMm(primaryPair.distance_mm, 1)} mm
                          {pairMeasures.length > 1 ? ` · ${pairMeasures.length}Δ` : ""}
                        </span>
                      </>
                    ) : null}
                    {linkArmed ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">
                          {linkFromId ? "link: 2nd pin" : "link: 1st pin"}
                        </span>
                      </>
                    ) : null}
                    {refArmed ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">
                          {refTargetId ? "ref: tap edge" : "ref: tap pin"}
                        </span>
                      </>
                    ) : null}
                    {lastPick?.offset && interactionMode === "pick" && !refArmed ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">
                          off={formatMm(lastPick.offset.distance_mm, 1)} mm
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="cad-hud__hint text-center">
                    {interactionMode === "pick"
                      ? refArmed
                        ? "Ref mode · tap pin (optional) · tap face near edge"
                        : linkArmed
                          ? "Link mode · tap two pins · empty face still places pins"
                          : `Multi-point OK · tap pin to remove · max ${MAX_PICKS}${picks.length >= MAX_PICKS ? " (full)" : ""}${primaryPair ? " · Δ shown" : ""}`
                      : regionTool === "rect"
                        ? `Rect on planar face · max ${MAX_REGIONS}${regions.length >= MAX_REGIONS ? " (full)" : ""}`
                        : `Freehand on face · max ${MAX_REGIONS}${regions.length >= MAX_REGIONS ? " (full)" : ""}`}
                    {hasAnnotations ? " · Copy sends all annotations" : ""}
                  </div>
                  <div className="cad-hud__actions">
                    {interactionMode === "pick" && picks.length >= 1 ? (
                      <button
                        type="button"
                        className={`cad-chip${refArmed ? " cad-chip--accent" : ""}`}
                        aria-pressed={refArmed}
                        onClick={toggleRef}
                      >
                        Ref
                      </button>
                    ) : null}
                    {interactionMode === "pick" && picks.length >= 2 ? (
                      <button
                        type="button"
                        className={`cad-chip${linkArmed ? " cad-chip--accent" : ""}`}
                        aria-pressed={linkArmed}
                        onClick={toggleLink}
                      >
                        Link
                      </button>
                    ) : null}
                    <button type="button" className="cad-chip" onClick={clearModeAnnotations}>
                      Clear
                    </button>
                    <button type="button" className="cad-chip" onClick={copyClick}>
                      Copy
                    </button>
                    <button type="button" className="cad-chip cad-chip--accent" onClick={promptClick}>
                      Prompt agent
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="cad-hud__primary text-center text-[var(--cad-overlay-muted)]">
                    {interactionMode === "region"
                      ? regionTool === "rect"
                        ? "Drag a rectangle on a planar face"
                        : "Tap a face, then draw a closed area"
                      : "Tap surfaces to mark picks"}
                  </div>
                  <div className="cad-hud__hint text-center">
                    {interactionMode === "region"
                      ? regionTool === "rect"
                        ? "Plane faces only · corners snap · 2-finger orbit"
                        : "1-finger draw · close the loop to keep · 2-finger orbit"
                      : "Tap place · hold+drag to snap · pinch zoom"}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {dropActive && <div className="cad-drop">Drop .glb file(s)</div>}
          {toast && (
            <div className="cad-toast" role="status" aria-live="polite">
              {toast}
            </div>
          )}
        </div>

        {/* Sheets are OUTSIDE the inert canvas subtree — fixes iOS Safari freeze */}
        <SheetShell
          open={compact && designsOpen}
          placement={designsPlacement}
          label="Designs"
          onClose={() => setDesignsOpen(false)}
        >
          <DesignsPanel
            designs={designs}
            selectedId={localParts ? undefined : designId}
            listStatus={designsListStatus}
            listError={designsListError}
            onRetry={() => void designsQuery.refetch()}
            onClose={() => setDesignsOpen(false)}
            onSelect={selectDesign}
            showClose
          />
        </SheetShell>

        <SheetShell
          open={compact && inspectorOpen}
          placement={partsPlacement}
          label="Parts and renders"
          onClose={() => setInspectorOpen(false)}
        >
          <PartsPanel
            parts={partUi}
            highlights={lastPick?.partIndex ?? -1}
            renders={localParts ? [] : (designQuery.data?.renders ?? [])}
            designId={localParts ? undefined : designId}
            onClose={() => setInspectorOpen(false)}
            showClose
            onTogglePart={(index, visible) => {
              sceneRef.current?.setPartVisible(index, visible)
              setPartUi((current) => current.map((part, i) => (i === index ? { ...part, visible } : part)))
            }}
            onSetAllVisible={setAllPartsVisible}
            onOpenRender={(url, label) => {
              setInspectorOpen(false)
              setRenderModal({ url, label })
            }}
          />
        </SheetShell>
      </div>

      {dockRails && (
        <aside className="cad-rail flex w-full min-h-0 shrink-0 border-t border-[var(--osc-border)] md:w-60 md:border-t-0 md:border-l">
          <PartsPanel
            parts={partUi}
            highlights={lastPick?.partIndex ?? -1}
            renders={localParts ? [] : (designQuery.data?.renders ?? [])}
            designId={localParts ? undefined : designId}
            onTogglePart={(index, visible) => {
              sceneRef.current?.setPartVisible(index, visible)
              setPartUi((current) => current.map((part, i) => (i === index ? { ...part, visible } : part)))
            }}
            onSetAllVisible={setAllPartsVisible}
            onOpenRender={(url, label) => setRenderModal({ url, label })}
          />
        </aside>
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
            className="osc-icon-btn absolute top-3 right-3 z-10 size-10 bg-[var(--osc-bg-elevated)] text-[var(--osc-text-muted)]"
            aria-label="Close render preview"
            onClick={() => setRenderModal(null)}
          >
            <CloseIcon />
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
      <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-3 text-[11px] text-[var(--osc-text-faint)] sm:px-4 pb-[env(safe-area-inset-bottom)]">
        <span className="cad-footer-meta">Read-only assembly inspection</span>
        <span className="cad-footer-note">Viewer does not mutate Data Root</span>
      </footer>
    </div>
  )
}
