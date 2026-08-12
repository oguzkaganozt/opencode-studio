import { useViewerRefresh } from "@ui/agent/use-viewer-refresh"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router"
import { claimAgentContext } from "@ui/agent-context"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Badge } from "@ui/components/badge"
import { Dialog, DialogHeader } from "@ui/components/dialog"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { StudioHomeHeader, StudioHomeTools, patchSearchParams } from "@ui/components/studio-home"
import { StudioShell } from "@ui/components/studio-shell"
import { cn } from "@ui/lib/cn"
import { artifactUrl, type DesignSummary, listDesigns, readDesign, readWorkspace, studioHref } from "./api"
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
import {
  CloseIcon,
  DesignsPanel,
  designStatus,
  PartsPanel,
  ReloadIcon,
  sceneMessageTone,
  type SheetPlacement,
  SheetShell,
  type Toast,
  useCadDesignEvents,
  useCadSpace,
  ViewCube,
} from "./design-workspace-chrome"

const AssemblyViewport = lazy(async () => {
  const module = await import("./assembly-viewport")
  return { default: module.AssemblyViewport }
})

function Shell({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <StudioShell studioId="cad" label="CAD" fill={fill}>
      {children}
    </StudioShell>
  )
}

function DesignCard({ design }: { design: DesignSummary }) {
  const status = designStatus(design.buildStatus)
  return (
    <Link to={studioHref(`designs/${encodeURIComponent(design.id)}`)} className="cad-card group" data-tone={status.railTone}>
      <span className="cad-card__rail" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold tracking-tight text-[var(--osc-text)]">{design.id}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--osc-text-muted)]" title={design.directory}>
            {design.directory}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={status.badgeTone}>{status.label}</Badge>
          <svg
            className="mt-0.5 h-4 w-4 text-[var(--osc-text-faint)] transition-transform duration-[var(--osc-motion-duration)] group-hover:translate-x-0.5 group-hover:text-[var(--osc-text-muted)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
      <div className="cad-card__meta" aria-label="Design summary">
        <span>
          {design.partCount} {design.partCount === 1 ? "part" : "parts"}
        </span>
        {design.revision ? <span className="font-mono">rev {design.revision.slice(0, 8)}</span> : <span>No build revision</span>}
      </div>
    </Link>
  )
}

function DesignsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["cad", "designs"], queryFn: listDesigns })
  const { data: workspace } = useQuery({ queryKey: ["cad", "workspace"], queryFn: () => readWorkspace() })
  useEffect(() => {
    if (!workspace?.root) return
    return claimAgentContext("cad-root", {
      key: "cad-root",
      kind: "cad-root",
      studioId: "cad",
      label: "CAD Studio",
      directory: workspace.root,
      historicalDirectory: workspace.root,
      status: "available",
    })
  }, [workspace?.root])
  const search = searchParams.get("q") ?? ""
  const filter = searchParams.get("status") ?? "all"
  const normalizedSearch = search.trim().toLowerCase()
  const designs = data ?? []
  const filtered = designs.filter((design) => {
    const matchesSearch = !normalizedSearch || `${design.id} ${design.directory}`.toLowerCase().includes(normalizedSearch)
    if (!matchesSearch) return false
    if (filter === "built") return design.buildStatus === "built"
    if (filter === "stale") return design.buildStatus === "stale"
    if (filter === "unbuilt") return design.buildStatus === "unbuilt"
    return true
  })

  const updateFilter = (key: "q" | "status", value: string) => {
    setSearchParams(patchSearchParams(searchParams, key, value), { replace: true })
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <StudioHomeHeader
        title="Designs"
        count={
          data
            ? `${filtered.length === designs.length ? designs.length : `${filtered.length} of ${designs.length}`} design${designs.length !== 1 ? "s" : ""}`
            : undefined
        }
      />

      {isLoading && (
        <div className="flex flex-col gap-3" role="status" aria-busy="true">
          <span className="sr-only">Loading designs…</span>
          <div className="osc-skeleton h-24 w-full" aria-hidden />
          <div className="osc-skeleton h-24 w-full max-w-md" aria-hidden />
        </div>
      )}

      {error && (
        <ErrorState
          className="border-dashed py-16"
          title="Failed to load designs"
          description={`${String(error)}. Check Studio Home and retry.`}
          action={
            <button type="button" className="cad-home-chip" onClick={() => void refetch()}>
              Retry
            </button>
          }
        />
      )}

      {data && designs.length === 0 && (
        <EmptyState
          className="border-dashed py-16"
          title="No designs yet"
          description="Scaffold and build a design with the agent — finished designs show up here."
          action={
            <button
              type="button"
              className="cad-home-chip cad-home-chip--primary"
              onClick={() =>
                requestAgentHandoff({
                  text: "Create a new CAD design in Studio Home, model the parts, then cad_design_build and open the viewer.",
                  source: "cad",
                  open: true,
                  copyFallback: true,
                })
              }
            >
              Draft design request
            </button>
          }
        />
      )}

      {data && designs.length > 0 && (
        <>
          <StudioHomeTools
            searchId="cad-design-search"
            searchLabel="Filter designs by id or path"
            searchPlaceholder="Filter designs…"
            search={search}
            onSearch={(value) => updateFilter("q", value)}
            filterAriaLabel="Build status"
            filter={filter}
            onFilter={(value) => updateFilter("status", value)}
            filters={[
              { value: "all", label: "All" },
              { value: "built", label: "Built" },
              { value: "stale", label: "Stale" },
              { value: "unbuilt", label: "Unbuilt" },
            ]}
            toolsClassName="cad-design-tools"
            filtersClassName="cad-design-filters"
            searchClassName="cad-home-input min-w-0 px-3"
            filterClassName="cad-filter"
          />

          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((design) => (
                <DesignCard key={design.id} design={design} />
              ))}
            </div>
          ) : (
            <EmptyState
              className="border-dashed py-14"
              title="No designs match"
              description="Try another name, path, or build-status filter."
              action={
                <button type="button" className="cad-home-chip" onClick={() => setSearchParams({}, { replace: true })}>
                  Clear filters
                </button>
              }
            />
          )}
        </>
      )}
    </div>
  )
}

function DesignWorkspace({ designId }: { designId: string }) {
  const navigate = useNavigate()
  const sceneRef = useRef<SceneHandle | null>(null)
  const { rootRef, compact, phone } = useCadSpace()
  const [status, setStatus] = useState("no model")
  const [statusTone, setStatusTone] = useState<"ok" | "waiting" | "idle">("idle")
  const [picks, setPicks] = useState<ClickInfo[]>([])
  const [linkedPairs, setLinkedPairs] = useState<LinkedPinPair[]>([])
  const [linkArmed, setLinkArmed] = useState(false)
  const [linkFromId, setLinkFromId] = useState<string | null>(null)
  const [regions, setRegions] = useState<RegionInfo[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null)
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("pick")
  const [regionTool, setRegionTool] = useState<RegionTool>("face")
  const [regionDraft, setRegionDraft] = useState<RegionDraft | null>(null)
  const [rectWInput, setRectWInput] = useState("")
  const [rectHInput, setRectHInput] = useState("")
  const [rectSizeDirty, setRectSizeDirty] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [rectSizeError, setRectSizeError] = useState<string | null>(null)
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
    queryFn: () => readDesign(designId),
  })
  const workspaceQuery = useQuery({
    queryKey: ["cad", "workspace", designId],
    queryFn: () => readWorkspace(designId),
  })
  const queryClient = useQueryClient()

  const designs = designsQuery.data ?? []
  const selectedDesign = designs.find((d) => d.id === designId)
  const selectedDesignDirectory = designQuery.data?.absoluteDirectory ?? selectedDesign?.absoluteDirectory
  const agentDirectory = selectedDesignDirectory ?? workspaceQuery.data?.directory

  useEffect(
    () =>
      claimAgentContext(`cad:${designId}`, {
        key: `cad:${designId}`,
        kind: "cad-project",
        studioId: "cad",
        projectId: designId,
        relativePath: designId,
        label: `CAD · ${designId}`,
        directory: agentDirectory,
        historicalDirectory: agentDirectory,
        status: selectedDesignDirectory ? "available" : designQuery.error ? "missing" : "checking",
      }),
    [agentDirectory, designId, designQuery.error, selectedDesignDirectory],
  )

  useViewerRefresh(selectedDesignDirectory, () => {
    void queryClient.invalidateQueries({ queryKey: ["cad", "designs"] })
    void queryClient.invalidateQueries({ queryKey: ["cad", "design", designId] })
  })

  const designRevision = designQuery.data?.revision ?? null

  const serverParts = useMemo<LoadPart[] | null>(() => {
    const artifact = designQuery.data?.artifact
    if (!artifact) return null
    const withGlb = artifact.parts.filter((part) => part.files?.glb)
    if (withGlb.length === 0) return null
    return withGlb.map((part, index) => ({
      name: part.id,
      url: artifactUrl(designId, part.files.glb),
      color: PART_COLORS[index % PART_COLORS.length]!,
      topoUrl: part.files.topo ? artifactUrl(designId, part.files.topo) : undefined,
    }))
  }, [designId, designQuery.data])

  useEffect(() => {
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
  }, [designId, designQuery.isLoading, designQuery.isError, designQuery.data])

  function showToast(message: string, tone: Toast["tone"] = "info") {
    setToast({ message, tone })
  }

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), toast.tone === "error" ? 5000 : 3200)
    return () => window.clearTimeout(id)
  }, [toast])

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
      sceneRef.current?.clearPicks()
      sceneRef.current?.clearRegions()
      sceneRef.current?.cancelRegionStroke()
      setPicks([])
      setLinkedPairs([])
      setLinkArmed(false)
      setLinkFromId(null)
      setRegions([])
      setSelectedRegionId(null)
      setSelectedPinId(null)
      setRegionDraft(null)
      setPartUi([])
      closeSheets()
      navigate(studioHref(`designs/${id}`))
    },
    [closeSheets, navigate],
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

  const renderCount = designQuery.data?.renders.length ?? 0
  const canOpenParts = Boolean(serverParts) || partCount > 0 || renderCount > 0
  const visiblePartCount = partUi.filter((part) => part.visible).length
  const allPartsHidden = partUi.length > 0 && visiblePartCount === 0
  const sceneBusy = Boolean(serverParts) && statusTone === "waiting" && status.includes("loading")
  const dockRails = !compact
  const sheetOpen = compact && (designsOpen || inspectorOpen)
  const designsPlacement: SheetPlacement = phone ? "bottom" : "side-left"
  const partsPlacement: SheetPlacement = phone ? "bottom" : "side-right"
  const buildStatus = designQuery.data?.buildStatus ?? selectedDesign?.buildStatus ?? "unbuilt"
  const buildLabel = buildStatus === "built" ? "Built" : buildStatus === "stale" ? "Stale" : "Unbuilt"
  const healthDetail =
    statusTone === "waiting" ? status : partCount > 0 ? `${partCount} ${partCount === 1 ? "part" : "parts"}` : undefined
  const buildHealthLabel = healthDetail ? `${buildLabel} · ${healthDetail}` : buildLabel
  const buildHealthClass =
    statusTone === "waiting"
      ? "cad-status-wait"
      : buildStatus === "built"
        ? "cad-status-ok"
        : buildStatus === "stale"
          ? "cad-status-wait"
          : "cad-status-idle"
  const revisionLabel = designQuery.data?.revision ? `Revision ${designQuery.data.revision.slice(0, 12)}` : "No build revision"

  const emptyTitle = designQuery.isError
    ? "Could not load design"
    : designQuery.isLoading
      ? "Loading design…"
      : "No build yet"

  const emptyBody = designQuery.isError
    ? ((designQuery.error as Error)?.message ?? "Reload the design, or choose another from Designs.")
    : designQuery.isLoading
      ? "Fetching assembly artifacts…"
      : "Build this design with the agent, then reload."

  const showEmptyActions = !designQuery.isLoading

  const requestDesignBuild = () => {
    requestAgentHandoff({
      text: `Build or rebuild the CAD design "${designId}", then verify its artifacts and refresh the Studio viewer.`,
      source: "cad",
      directory: selectedDesignDirectory,
      open: true,
      copyFallback: true,
    })
    showToast("Opened build request in agent")
  }

  const reload = () => {
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

  const formatAnnotationText = (options?: { selectionOnly?: boolean }) => {
    const selectionOnly = Boolean(options?.selectionOnly)
    const activePicks = selectionOnly && selectedPinId ? picks.filter((p) => p.id === selectedPinId) : picks
    const activeRegions = selectionOnly && selectedRegionId ? regions.filter((r) => r.id === selectedRegionId) : regions
    if (activePicks.length === 0 && activeRegions.length === 0) return ""
    const designLine = designId
      ? `design=${designId}${designRevision ? ` revision=${designRevision.slice(0, 12)}` : ""}`
      : ""
    const pointLines = activePicks.map((pick, index) => {
      const face =
        pick.faceId !== null ? `face=${pick.faceId}${pick.faceType ? ` (${pick.faceType})` : ""}` : "face=unknown"
      const point = `point_mm=(${pick.position.x}, ${pick.position.y}, ${pick.position.z})`
      const normal = `normal=(${pick.normal.x}, ${pick.normal.y}, ${pick.normal.z})`
      const snap = pick.snap ?? "free"
      const quality = pick.quality ?? "mesh-approx"
      return `  ${index + 1}) part=${pick.part} ${face} ${point} ${normal} direction=${pick.direction} snap=${snap} quality=${quality}`
    })
    const regionLines = activeRegions.map((region, index) => {
      const kind = region.kind ?? "freehand"
      const head = `  ${index + 1}) part=${region.part} face=${region.faceId}${region.faceType ? ` type=${region.faceType}` : ""} kind=${kind} approximation=${region.approximation}`
      const sizeLine = region.size
        ? (() => {
            const dp = region.size.quality === "construction" ? 3 : 1
            return `     size_mm=width=${formatMm(region.size.width_mm, dp)} height=${formatMm(region.size.height_mm, dp)} quality=${region.size.quality} frame=${region.size.frame}`
          })()
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
    const measureLines = selectionOnly
      ? []
      : pairMeasures.map(
          (pair, i) =>
            `  ${i + 1}) kind=pin_distance from_point=${pair.fromIndex} to_point=${pair.toIndex} distance_mm=${formatMm(pair.distance_mm, 2)} quality=${pair.quality} source=${pair.source}`,
        )

    const blocks: string[] = []
    if (designLine) blocks.push(designLine)
    const measureNote = measureLines.length > 0 ? `, ${measureLines.length} measure(s)` : ""
    blocks.push(
      selectionOnly
        ? `User selected CAD viewer geometry (${activePicks.length} pin(s), ${activeRegions.length} region(s)).`
        : `User marked annotations in the CAD viewer (${activePicks.length} point(s), ${activeRegions.length} region(s)${measureNote}).`,
    )
    if (activePicks.length > 0) blocks.push(`points (${activePicks.length}):`, ...pointLines)
    if (measureLines.length > 0) blocks.push(`measures (${measureLines.length}):`, ...measureLines)
    if (activeRegions.length > 0) blocks.push(`regions (${activeRegions.length}):`, ...regionLines)
    const partNames = [...new Set([...activePicks.map((p) => p.part), ...activeRegions.map((r) => r.part)])]
    const stepHint =
      designId && partNames.length > 0
        ? ` Prefer STEP under step/ for: ${partNames.map((p) => `${p}.step`).join(", ")} (design ${designId}).`
        : ""
    blocks.push(
      `Points = locations; regions = face zones; measures = viewer working distances (linked pairs and/or last pin pair). Working dimensions are intent only — verify on STEP with cad_measure/cad_compare before manufacturing claims. Map face ids on STEP, edit part sources, then cad_design_build.${stepHint}`,
    )
    return blocks.join("\n")
  }

  const sendToAgent = () => {
    const selectionOnly = interactionMode === "select" && Boolean(selectedPinId || selectedRegionId)
    if (!hasAnnotations && !selectionOnly) {
      showToast(
        interactionMode === "region"
          ? "Draw a region first"
          : interactionMode === "select"
            ? "Select or mark annotations first"
            : "Tap a surface first",
        "error",
      )
      return
    }
    const annotation = formatAnnotationText({ selectionOnly })
    if (!annotation) {
      showToast("Nothing to send", "error")
      return
    }
    const partNames = [
      ...new Set([
        ...(selectionOnly && selectedPinId ? picks.filter((p) => p.id === selectedPinId) : picks).map((p) => p.part),
        ...(selectionOnly && selectedRegionId ? regions.filter((r) => r.id === selectedRegionId) : regions).map((r) => r.part),
      ]),
    ]
    const paths: string[] = []
    if (selectedDesignDirectory) {
      paths.push(selectedDesignDirectory)
      for (const part of partNames) {
        paths.push(`${selectedDesignDirectory}/step/${part}.step`)
      }
    }
    requestAgentHandoff({
      text: selectionOnly
        ? "Inspect the selected CAD geometry and propose the next design change."
        : "Review these CAD viewer annotations and apply the requested geometry changes.",
      source: "cad",
      directory: selectedDesignDirectory,
      paths: paths.length ? paths : undefined,
      annotation,
      open: true,
      copyFallback: true,
    })
    showToast("Added to Agent composer")
  }

  const clearModeAnnotations = () => {
    if (interactionMode === "pick") {
      sceneRef.current?.clearPicks()
      setPicks([])
      setLinkedPairs([])
      setLinkArmed(false)
      setLinkFromId(null)
      setSelectedPinId(null)
      return
    }
    if (interactionMode === "select") {
      // Bulk wipe of all annotations (Delete removes only the selection).
      sceneRef.current?.clearPicks()
      sceneRef.current?.clearRegions()
      sceneRef.current?.cancelRegionStroke()
      setPicks([])
      setLinkedPairs([])
      setLinkArmed(false)
      setLinkFromId(null)
      setRegions([])
      setSelectedRegionId(null)
      setSelectedPinId(null)
      setRegionDraft(null)
      return
    }
    sceneRef.current?.clearRegions()
    sceneRef.current?.cancelRegionStroke()
    setRegions([])
    setSelectedRegionId(null)
    setRegionDraft(null)
  }

  const deleteSelected = () => {
    const ok = sceneRef.current?.deleteSelected()
    if (!ok) {
      showToast("Nothing selected", "error")
      return
    }
    setPicks(sceneRef.current?.getPicks() ?? [])
    setLinkedPairs(sceneRef.current?.getLinkedPairs() ?? [])
    setRegions(sceneRef.current?.getRegions() ?? [])
    setSelectedRegionId(sceneRef.current?.getSelectedRegionId() ?? null)
    setSelectedPinId(sceneRef.current?.getSelectedPinId() ?? null)
  }

  const setMode = (mode: InteractionMode) => {
    setInteractionMode(mode)
    sceneRef.current?.setInteractionMode(mode)
    if (mode !== "pick") {
      setLinkArmed(false)
      setLinkFromId(null)
    }
  }

  const toggleLink = () => {
    const next = !linkArmed
    setLinkArmed(next)
    if (!next) setLinkFromId(null)
    sceneRef.current?.setLinkArmed(next)
  }

  const setTool = (tool: RegionTool) => {
    setRegionTool(tool)
    sceneRef.current?.setRegionTool(tool)
  }

  const lastPick = picks.length > 0 ? picks[picks.length - 1]! : null
  const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? null
  const selectedPin = picks.find((p) => p.id === selectedPinId) ?? null
  // Only the real selection — never fall back to “last rect” (wrong W×H when face/empty selected).
  const activeRect = selectedRegion?.kind === "rect" && selectedRegion.size ? selectedRegion : null
  const hasSelectTarget = Boolean(selectedRegion || selectedPin)
  const drawingRegion = Boolean(regionDraft?.active && (regionDraft.pointCount > 0 || regionDraft.faceId !== null))
  const drawingRect =
    drawingRegion &&
    (regionDraft?.tool === "rect" || regionTool === "rect") &&
    regionDraft?.width_mm != null &&
    regionDraft?.height_mm != null

  useEffect(() => {
    if (!activeRect?.size) {
      setRectWInput("")
      setRectHInput("")
      setRectSizeDirty(false)
      setRectSizeError(null)
      return
    }
    const dp = activeRect.size.quality === "construction" ? 2 : 1
    setRectWInput(formatMm(activeRect.size.width_mm, dp))
    setRectHInput(formatMm(activeRect.size.height_mm, dp))
    setRectSizeDirty(false)
    setRectSizeError(null)
  }, [activeRect?.id, activeRect?.size?.width_mm, activeRect?.size?.height_mm, activeRect?.size?.quality])

  const applyRectSize = () => {
    if (!activeRect?.size) return
    // Only apply after real keystrokes — focus/blur alone must not rewrite size or quality.
    // (Display rounds to 1–2 dp while storage is 3 dp; float compare would false-positive.)
    if (!rectSizeDirty) return
    const validNumber = /^(?:\d+(?:\.\d*)?|\.\d+)$/
    const w = Number(rectWInput.trim())
    const h = Number(rectHInput.trim())
    if (!validNumber.test(rectWInput.trim()) || !validNumber.test(rectHInput.trim()) || w <= 0 || h <= 0) {
      setRectSizeError("Width and height must be positive numbers.")
      return
    }
    const ok = sceneRef.current?.setRegionRectSize(activeRect.id, w, h)
    if (!ok) {
      const size = activeRect.size
      const dp = size.quality === "construction" ? 2 : 1
      setRectWInput(formatMm(size.width_mm, dp))
      setRectHInput(formatMm(size.height_mm, dp))
      setRectSizeDirty(false)
      setRectSizeError("That size cannot be applied to this face.")
      return
    }
    setRectSizeDirty(false)
    setRectSizeError(null)
  }

  const toggleDesigns = () => {
    setDesignsOpen((v) => !v)
    setInspectorOpen(false)
  }

  const toggleParts = () => {
    setInspectorOpen((v) => !v)
    setDesignsOpen(false)
  }

  const designControlLabel = selectedDesign?.id ?? (designs.length ? "Server designs" : "No designs")
  const highlightedPart =
    interactionMode === "select"
      ? (selectedPin?.partIndex ?? selectedRegion?.partIndex ?? -1)
      : interactionMode === "region"
        ? (selectedRegion?.partIndex ?? partUi.findIndex((part) => part.name === regionDraft?.part))
        : (lastPick?.partIndex ?? -1)

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
            selectedId={designId}
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
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            showToast("Choose a server design from the Designs list")
          }}
        >
          <div
            className="cad-toolbar absolute top-3 z-10"
            role="toolbar"
            aria-label="CAD viewer tools. Scroll horizontally for more tools."
          >
            <Link to={studioHref()} className="cad-chip cad-chip--icon" aria-label="All designs" title="All designs">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            {compact ? (
              <button
                type="button"
                className="cad-design-id"
                aria-expanded={designsOpen}
                aria-controls="cad-designs-sheet"
                aria-haspopup="dialog"
                aria-label={`Choose server design, current ${designControlLabel}`}
                title="Change server design"
                onClick={toggleDesigns}
              >
                <span className="cad-design-name">{designControlLabel}</span>
              </button>
            ) : selectedDesign ? (
              <span className="cad-design-id" title={selectedDesign.id}>
                <span className="cad-design-name">{selectedDesign.id}</span>
              </span>
            ) : null}

            {compact ? (
              <button
                type="button"
                className={`cad-status-btn ${buildHealthClass}`}
                aria-expanded={inspectorOpen}
                aria-controls="cad-parts-sheet"
                aria-haspopup="dialog"
                aria-label={
                  canOpenParts
                    ? `Parts and renders, ${buildHealthLabel}, ${revisionLabel}${renderCount ? `, ${renderCount} renders` : ""}`
                    : `${buildHealthLabel}, ${revisionLabel}`
                }
                title={revisionLabel}
                disabled={statusTone === "waiting" && !canOpenParts}
                onClick={toggleParts}
              >
                {buildHealthLabel}
                <svg className="cad-status-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className={`cad-status ${buildHealthClass}`} title={revisionLabel} aria-live="polite">
                {buildHealthLabel}
              </span>
            )}

            <span className="cad-sep" aria-hidden />

            <span className="cad-seg" role="group" aria-label="Annotation tool">
              <button
                type="button"
                className="cad-chip"
                aria-pressed={interactionMode === "pick"}
                title="Place precise pins on surfaces"
                onClick={() => setMode("pick")}
              >
                Pin
              </button>
              <button
                type="button"
                className="cad-chip"
                aria-pressed={interactionMode === "region"}
                title="Mark a face or surface area"
                onClick={() => setMode("region")}
              >
                Region
              </button>
              <button
                type="button"
                className="cad-chip"
                aria-pressed={interactionMode === "select"}
                title="Select and edit annotations"
                onClick={() => setMode("select")}
              >
                Select
              </button>
            </span>

            {interactionMode === "region" ? (
              <span className="cad-seg" role="group" aria-label="Region shape">
                <button
                  type="button"
                  className="cad-chip"
                  aria-pressed={regionTool === "face"}
                  onClick={() => setTool("face")}
                >
                  Face
                </button>
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
                  Freehand
                </button>
              </span>
            ) : null}

            <button type="button" className="cad-chip" disabled={partCount === 0} onClick={fitView} aria-label="Fit view">
              Fit
            </button>
            <button type="button" className="cad-chip cad-chip--icon" onClick={reload} aria-label="Reload">
              <ReloadIcon />
            </button>
          </div>

          {partCount > 0 ? <ViewCube onView={(view) => sceneRef.current?.setView(view)} /> : null}

          {!serverParts && (
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-start justify-center px-4 pt-28 sm:items-center sm:pt-0">
              <div className="cad-empty" role={designQuery.isError ? "alert" : "status"}>
                <p className="cad-empty__title">{emptyTitle}</p>
                <p className="cad-empty__body">{emptyBody}</p>
                {showEmptyActions ? (
                  <div className="cad-empty__actions">
                    {designQuery.isError ? (
                      <button type="button" className="cad-chip" onClick={() => void designQuery.refetch()}>
                        Retry
                      </button>
                    ) : null}
                    {!designQuery.isError ? (
                      <button type="button" className="cad-chip cad-chip--accent" onClick={requestDesignBuild}>
                        Build with agent
                      </button>
                    ) : null}
                    {compact && designs.length > 1 ? (
                      <button
                        type="button"
                        className="cad-chip"
                        onClick={() => {
                          setDesignsOpen(true)
                          setInspectorOpen(false)
                        }}
                      >
                        Switch design
                      </button>
                    ) : null}
                    <Link to={studioHref()} className="cad-chip">
                      All designs
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {sceneBusy ? (
            <div className="cad-scene-progress" role="status" aria-live="polite">
              <span className="cad-skeleton" aria-hidden />
              Loading geometry…
            </div>
          ) : null}

          {allPartsHidden ? (
            <div className="cad-all-hidden" role="status">
              <span>All parts hidden</span>
              <button type="button" className="cad-chip" onClick={() => setAllPartsVisible(true)}>
                Show all
              </button>
            </div>
          ) : null}

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
              sceneRef={sceneRef}
              onPicksChange={setPicks}
              onLinkedPairsChange={(pairs, meta) => {
                setLinkedPairs(pairs)
                setLinkArmed(meta.armed)
                setLinkFromId(meta.fromId)
              }}
              onRegionsChange={setRegions}
              onRegionDraftChange={setRegionDraft}
              onSelectedRegionChange={setSelectedRegionId}
              onSelectedPinChange={setSelectedPinId}
              onMessage={(message) => showToast(message, sceneMessageTone(message))}
              onError={() => {
                setStatus("viewport unavailable")
                setStatusTone("waiting")
              }}
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
                  setStatus(`${result.loaded} part(s)`)
                  setStatusTone("ok")
                }
              }}
            />
          </Suspense>

          {!sheetOpen && (hasAnnotations || drawingRegion || serverParts) ? (
            <div
              className={`cad-hud absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-10 w-[calc(100%-1.25rem)] max-w-xl -translate-x-1/2 px-3 py-2.5 ${hasAnnotations || drawingRegion ? "" : "cad-hud--hint pointer-events-none"}`}
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
                    <span className="text-[var(--cad-overlay-muted)]">
                      {drawingRect ? " · rect…" : " · drawing…"}
                    </span>
                  </div>
                  <div className="cad-hud__hint text-center">
                    {drawingRect || regionTool === "rect"
                      ? "Drag opposite corner · sizes on canvas · lift to keep"
                      : regionTool === "face"
                        ? "Tap face to keep"
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
                    {interactionMode === "select" && selectedPin ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">
                          pin · {selectedPin.part}
                          {selectedPin.faceId !== null ? ` · face ${selectedPin.faceId}` : ""}
                        </span>
                      </>
                    ) : null}
                    {(interactionMode === "region" || interactionMode === "select") && selectedRegion ? (
                      <>
                        <span className="text-[var(--cad-overlay-muted)]"> · </span>
                        <span className="font-medium text-[var(--osc-warning)]">
                          {selectedRegion.part} · face {selectedRegion.faceId}
                          {selectedRegion.kind === "rect"
                            ? " · rect"
                            : selectedRegion.kind === "face"
                              ? " · face"
                              : selectedRegion.kind === "freehand"
                                ? " · free"
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
                  </div>
                  <div className="cad-hud__hint text-center">
                    {interactionMode === "pick"
                      ? linkArmed
                        ? "Link mode · tap two pins · empty face still places pins"
                        : `Multi-point OK · tap pin to remove · max ${MAX_PICKS}${picks.length >= MAX_PICKS ? " (full)" : ""}${primaryPair ? " · Δ shown" : ""}`
                      : interactionMode === "select"
                        ? hasSelectTarget
                          ? activeRect?.size
                            ? "Selected · edit W×H or Delete · empty deselects"
                            : "Selected · Delete removes it · empty deselects"
                          : "Tap a pin or region · empty deselects"
                        : regionTool === "face"
                          ? `Tap a face · max ${MAX_REGIONS}${regions.length >= MAX_REGIONS ? " (full)" : ""}`
                          : regionTool === "rect"
                            ? `Rect on planar face · max ${MAX_REGIONS}${regions.length >= MAX_REGIONS ? " (full)" : ""}`
                            : `Freehand on face · max ${MAX_REGIONS}${regions.length >= MAX_REGIONS ? " (full)" : ""}`}
                    {hasAnnotations
                      ? interactionMode === "select" && hasSelectTarget
                        ? " · Send includes selection"
                        : " · Send includes all annotations"
                      : ""}
                  </div>
                  <div className="cad-hud__actions">
                    {interactionMode === "select" && activeRect?.size ? (
                      <div>
                        <div className="cad-hud__dims" role="group" aria-label="Rectangle size mm">
                          <label className="cad-hud__dim">
                            <span>W</span>
                            <input
                              className="cad-hud__dim-input"
                              type="text"
                              inputMode="decimal"
                              enterKeyHint="done"
                              value={rectWInput}
                              onChange={(e) => {
                                setRectWInput(e.target.value)
                                setRectSizeDirty(true)
                                setRectSizeError(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  applyRectSize()
                                }
                              }}
                              aria-label="Width mm"
                              aria-invalid={Boolean(rectSizeError)}
                              aria-describedby={rectSizeError ? "cad-rect-size-error" : undefined}
                            />
                          </label>
                          <span className="cad-hud__dim-x" aria-hidden="true">
                            ×
                          </span>
                          <label className="cad-hud__dim">
                            <span>H</span>
                            <input
                              className="cad-hud__dim-input"
                              type="text"
                              inputMode="decimal"
                              enterKeyHint="done"
                              value={rectHInput}
                              onChange={(e) => {
                                setRectHInput(e.target.value)
                                setRectSizeDirty(true)
                                setRectSizeError(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  applyRectSize()
                                }
                              }}
                              aria-label="Height mm"
                              aria-invalid={Boolean(rectSizeError)}
                              aria-describedby={rectSizeError ? "cad-rect-size-error" : undefined}
                            />
                          </label>
                          <button type="button" className="cad-chip" disabled={!rectSizeDirty} onClick={applyRectSize}>
                            Apply
                          </button>
                        </div>
                        {rectSizeError ? (
                          <p id="cad-rect-size-error" className="cad-hud__error" role="alert">
                            {rectSizeError}
                          </p>
                        ) : null}
                      </div>
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
                    {interactionMode === "select" ? (
                      <button
                        type="button"
                        className="cad-chip cad-chip--warn"
                        disabled={!hasSelectTarget}
                        onClick={deleteSelected}
                      >
                        Delete
                      </button>
                    ) : null}
                    <button type="button" className="cad-chip" onClick={clearModeAnnotations}>
                      {interactionMode === "pick"
                        ? "Clear pins"
                        : interactionMode === "region"
                          ? "Clear regions"
                          : "Clear all"}
                    </button>
                    <button type="button" className="cad-chip cad-chip--accent" onClick={sendToAgent}>
                      Send to Agent
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="cad-hud__primary text-center text-[var(--cad-overlay-muted)]">
                    {interactionMode === "select"
                      ? "Select a pin or region to reference it in Agent"
                      : interactionMode === "region"
                        ? regionTool === "face"
                          ? "Mark a face to reference geometry in Agent"
                          : regionTool === "rect"
                            ? "Mark an area to reference geometry in Agent"
                            : "Draw an area to reference geometry in Agent"
                        : "Place a pin to reference geometry in Agent"}
                  </div>
                  <div className="cad-hud__hint text-center">
                    {interactionMode === "select"
                      ? "Select mode · no draw · orbit freely"
                      : interactionMode === "region"
                        ? regionTool === "face"
                          ? "Whole face · outline from mesh · orbit freely"
                          : regionTool === "rect"
                            ? "Plane faces only · corners snap · 2-finger orbit"
                            : "1-finger draw · close the loop to keep · 2-finger orbit"
                        : "Tap place · hold+drag to snap · pinch zoom"}
                  </div>
                </>
              )}
            </div>
          ) : null}

          <div className="sr-only" aria-live="polite">
            {partsLabel}. {picks.length} pins. {regions.length} regions. {interactionMode} mode.
          </div>
          {toast && (
            <div
              className="cad-toast"
              data-tone={toast.tone}
              role={toast.tone === "error" ? "alert" : "status"}
              aria-live={toast.tone === "error" ? "assertive" : "polite"}
            >
              {toast.message}
            </div>
          )}
        </div>

        {/* Sheets are OUTSIDE the inert canvas subtree — fixes iOS Safari freeze */}
        <SheetShell
          open={compact && designsOpen}
          id="cad-designs-sheet"
          placement={designsPlacement}
          label="Designs"
          onClose={() => setDesignsOpen(false)}
        >
          <DesignsPanel
            designs={designs}
            selectedId={designId}
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
          id="cad-parts-sheet"
          placement={partsPlacement}
          label="Parts and renders"
          onClose={() => setInspectorOpen(false)}
        >
          <PartsPanel
            parts={partUi}
            highlightedPart={highlightedPart}
            renders={designQuery.data?.renders ?? []}
            showRenders
            designId={designId}
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
            highlightedPart={highlightedPart}
            renders={designQuery.data?.renders ?? []}
            showRenders
            designId={designId}
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
        title={renderModal ? `Render preview: ${renderModal.label}` : "Render preview"}
        overlayClassName="z-[200] bg-black/90"
        className="max-w-[min(90vw,56rem)] border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)] shadow-[var(--osc-shadow-md)]"
      >
        <DialogHeader title={renderModal?.label ?? "Render preview"} onClose={() => setRenderModal(null)} />
        <div className="relative p-3">
          {renderModal && (
            <img
              src={renderModal.url}
              alt={renderModal.label}
              className="mx-auto max-h-[calc(85dvh-5rem)] max-w-full rounded-[var(--osc-radius-md)] border border-[var(--osc-border)]"
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

function DesignRoute() {
  const { id } = useParams()
  if (!id) return <Navigate to=".." replace />
  return (
    <Shell fill>
      <DesignWorkspace designId={id} />
      <footer className="flex min-h-8 shrink-0 items-center justify-between gap-3 border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-3 py-1 text-[11px] text-[var(--osc-text-muted)] sm:px-4 pb-[max(.25rem,env(safe-area-inset-bottom))]">
        <span className="cad-footer-meta">Inspect + annotate · source files unchanged</span>
        <span className="cad-footer-note">Measurements are working references until verified on STEP</span>
      </footer>
    </Shell>
  )
}

export function App() {
  return (
    <>
      <HashRedirect />
      <Routes>
        <Route
          index
          element={
            <Shell>
              <DesignsPage />
            </Shell>
          }
        />
        <Route path="designs/:id" element={<DesignRoute />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </>
  )
}
