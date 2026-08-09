import type { Part, PermissionRequest, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Link } from "react-router"
import type { StudioSessionContext, StudioSessionHistoryItem } from "../../src/core/session-history"
import { type AgentContext, getAgentContext, homeAgentContext, subscribeAgentContext } from "../agent-context"
import { type AgentHandoffRequest, subscribeAgentHandoff } from "../agent-handoff"
import { type AgentStatus, agentStatusDotClass, deriveAgentStatus } from "../agent-status"
import { AGENT_WIDTH_MAX, AGENT_WIDTH_MIN, clampAgentWidth, readAgentWidth, viewportAgentWidthMax, writeAgentWidth } from "../agent-width"
import { Button } from "../components/button"
import { useFocusTrap } from "../lib/focus-trap"
import { publishAgentFileEvent } from "./agent-file-events"
import {
  type AgentMessage,
  abortSession,
  createSession,
  listMessages,
  listPendingPermissions,
  listProviders,
  listSessionHistory,
  listSessionStatuses,
  probeAgentHealth,
  promptSessionAsync,
  replyPermission,
  sessionDiff,
  subscribeAgentEvents,
} from "./client"
import { Markdown } from "./markdown"
import { availableModelVariants, modelVariantLabel } from "./model-variant"
import { summarizePart, textFromParts, toolDetail, toolLabel, toolPreview, toolStatus } from "./part-text"
import { sessionGroupsByLastMessage, sessionLabel, sessionOptionLabels } from "./session-label"

type ModelPreference = { providerID: string; modelID: string }
type ModelRef = ModelPreference & { variants: string[] }
type AgentPrefs = { model?: ModelPreference; variants?: Record<string, string> }

type ComposerChip = {
  id: string
  kind: "path" | "annotation"
  value: string
  label: string
}

type ComposerState = {
  draft: string
  chips: ComposerChip[]
}

type PendingSession = { id: string; directory: string }

function checkingContext(): AgentContext {
  return { key: "route", kind: "home", label: "Loading context…", status: "checking" }
}

function contextFromHistory(context: StudioSessionContext): AgentContext {
  return context
}

function contextMetadata(context: AgentContext): StudioSessionContext {
  if (!context.directory) throw new Error("Agent context directory is unavailable")
  return {
    schema: 1,
    key: context.key,
    kind: context.kind,
    label: context.label,
    studioId: context.studioId,
    projectId: context.projectId,
    relativePath: context.relativePath,
    directory: context.directory,
    historicalDirectory: context.historicalDirectory ?? context.directory,
    status: context.status === "checking" ? "missing" : context.status,
  }
}

function contextLink(context: AgentContext): { href: string; label: string } | undefined {
  if (!context.projectId) return undefined
  const id = encodeURIComponent(context.projectId)
  if (context.kind === "cad-project") return { href: `/studios/cad/designs/${id}`, label: "Open design" }
  if (context.kind === "pcb-project") return { href: `/studios/pcb/projects/${id}/schematic`, label: "Open project" }
  return undefined
}

function sameContext(left: AgentContext, right: AgentContext): boolean {
  return (
    left.key === right.key &&
    left.directory === right.directory &&
    left.historicalDirectory === right.historicalDirectory &&
    left.label === right.label &&
    left.relativePath === right.relativePath &&
    left.status === right.status
  )
}

function handoffChips(handoff: AgentHandoffRequest): ComposerChip[] {
  const chips: ComposerChip[] = []
  for (const value of handoff.paths ?? []) {
    chips.push({ id: `path:${value}`, kind: "path", value, label: value.split("/").pop() || value })
  }
  if (handoff.annotation?.trim()) {
    const value = handoff.annotation.trim()
    chips.push({
      id: `ann:${value.slice(0, 48)}`,
      kind: "annotation",
      value,
      label: value.length > 36 ? `${value.slice(0, 36)}…` : value,
    })
  }
  return chips
}

function historyItem(session: Session, context: AgentContext): StudioSessionHistoryItem {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    parentID: session.parentID,
    model: session.model,
    time: session.time,
    context: contextMetadata(context),
  }
}

function composerKey(contextKey: string, directory: string, sessionID?: string): string {
  return `${contextKey}\0${directory}\0${sessionID ?? "new"}`
}

type PopoverKind = "session" | "model" | "variant" | null

const MODEL_UI_LIMIT = 80

function useMdUp() {
  const [mdUp, setMdUp] = useState(() => (typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true))
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const onChange = () => setMdUp(mq.matches)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return mdUp
}

function prefsKey(directory: string) {
  return `osc-agent-prefs:${directory}`
}

function readPrefs(directory: string): AgentPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(directory))
    if (!raw) return {}
    return JSON.parse(raw) as AgentPrefs
  } catch {
    return {}
  }
}

function writePrefs(directory: string, prefs: AgentPrefs) {
  try {
    localStorage.setItem(prefsKey(directory), JSON.stringify(prefs))
  } catch {
    // ignore
  }
}

function modelKey(model: ModelRef) {
  return `${model.providerID}/${model.modelID}`
}

function modelLabel(model: ModelRef) {
  return model.modelID
}

function roleOf(info: AgentMessage["info"]): "user" | "assistant" | "other" {
  const role = "role" in info ? String(info.role) : ""
  if (role === "user") return "user"
  if (role === "assistant") return "assistant"
  return "other"
}

type AssistantBlock = { id: string; kind: "tools"; parts: Part[] } | { id: string; kind: "text"; text: string }

/** Chronological blocks: consecutive tool parts group into one quiet list, text parts render as markdown. */
function assistantBlocks(parts: Part[]): AssistantBlock[] {
  const blocks: AssistantBlock[] = []
  for (const part of parts) {
    if (part.type === "tool") {
      const last = blocks[blocks.length - 1]
      if (last?.kind === "tools") last.parts.push(part)
      else blocks.push({ id: part.id, kind: "tools", parts: [part] })
      continue
    }
    if (part.type === "text" && typeof (part as { text?: string }).text === "string") {
      const text = (part as { text: string }).text.trim()
      if (!text) continue
      const last = blocks[blocks.length - 1]
      if (last?.kind === "text") last.text = `${last.text}\n\n${text}`
      else blocks.push({ id: part.id, kind: "text", text })
    }
  }
  return blocks
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const role = roleOf(message.info)
  const text = textFromParts(message.parts)
  if (role === "user") {
    return (
      <div className="oc-msg oc-msg--user">
        <div className="oc-msg__bubble">{text || "…"}</div>
      </div>
    )
  }
  const blocks = assistantBlocks(message.parts)
  const summaries = message.parts.map(summarizePart).filter((summary): summary is string => Boolean(summary))
  if (blocks.length === 0 && summaries.length === 0) return null
  return (
    <div className="oc-msg oc-msg--assistant">
      {blocks.map((block) =>
        block.kind === "tools" ? (
          <div key={block.id} className="oc-msg__tools">
            {block.parts.map((part) => (
              <ToolCard key={part.id} part={part} />
            ))}
          </div>
        ) : (
          <Markdown key={block.id} text={block.text} />
        ),
      )}
      {blocks.length === 0
        ? summaries.map((summary, index) => (
            <p key={`${message.info.id}:summary:${index}`} className="oc-msg__meta">
              {summary}
            </p>
          ))
        : null}
    </div>
  )
}

function ToolCard({ part }: { part: Part }) {
  const label = toolLabel(part) ?? "tool"
  const status = toolStatus(part)
  const detail = toolDetail(part)
  const preview = toolPreview(part)
  const statusClass = status === "error" ? " is-error" : status === "running" || status === "pending" ? " is-live" : ""
  const inner = (
    <>
      <span className="oc-tool__icon" aria-hidden>
        <ToolIcon tool={label} />
      </span>
      <span className="oc-tool__name">{label}</span>
      {preview ? <span className="oc-tool__preview">{preview}</span> : null}
      {status ? <span className={`oc-tool__status${statusClass}`}>{status}</span> : null}
    </>
  )
  if (!detail) {
    return <div className="oc-tool oc-tool--static">{inner}</div>
  }
  return (
    <details className={`oc-tool${status === "error" ? " oc-tool--error" : ""}`}>
      <summary>
        {inner}
        <span className="oc-tool__chevron" aria-hidden>
          <IconChevron />
        </span>
      </summary>
      <pre className="oc-tool__detail">{detail}</pre>
    </details>
  )
}

function ToolIcon({ tool }: { tool: string }) {
  const path =
    tool === "bash" ? (
      <path d="M4 5.5 7.5 8 4 10.5M9 10.5h4" />
    ) : tool === "read" || tool === "glob" ? (
      <>
        <path d="M5 3h4.5L12 5.5V13H5z" />
        <path d="M9.5 3v2.5H12" />
      </>
    ) : tool === "edit" || tool === "write" ? (
      <path d="M10.8 3.6 12.4 5.2M3.5 12.5l.6-2.2L11 3.4l1.6 1.6-6.9 6.9z" />
    ) : tool === "grep" || tool === "websearch" ? (
      <>
        <circle cx="7" cy="7" r="3.5" />
        <path d="m9.8 9.8 3 3" />
      </>
    ) : tool === "webfetch" ? (
      <>
        <circle cx="8" cy="8" r="5" />
        <path d="M3 8h10M8 3c-1.6 1.6-2.4 3.2-2.4 5s.8 3.4 2.4 5c1.6-1.6 2.4-3.2 2.4-5S9.6 4.6 8 3z" />
      </>
    ) : tool === "task" || tool === "todowrite" || tool === "todoread" ? (
      <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" />
    ) : (
      <>
        <circle cx="8" cy="8" r="1.75" />
        <path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2" />
      </>
    )
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconHome() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 6.25 7 2l5 4.25v5.25H8.75V8.25h-3.5v3.25H2V6.25Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  )
}

function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 12.5V3.5M8 3.5L4 7.5M8 3.5L12 7.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconStop() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  )
}

function IconChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AgentPanel({
  studioRoot,
  available,
  open,
  onClose,
  onStatusChange,
  fullPage = false,
  historyScope = "directory",
}: {
  studioRoot: string
  available: boolean
  open: boolean
  onClose: () => void
  onStatusChange?: (status: AgentStatus) => void
  fullPage?: boolean
  historyScope?: "studio" | "directory"
}) {
  const panelRef = useRef<HTMLElement>(null)
  const setPanelRef = useCallback((node: HTMLElement | null) => {
    panelRef.current = node
  }, [])
  const widthRef = useRef(readAgentWidth())
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const mdUp = useMdUp()
  const [width, setWidth] = useState(() => readAgentWidth())
  const [dragging, setDragging] = useState(false)
  const [viewportMax, setViewportMax] = useState(() =>
    typeof window !== "undefined" ? viewportAgentWidthMax(window.innerWidth) : AGENT_WIDTH_MAX,
  )
  const homeContext = useMemo(() => homeAgentContext(studioRoot), [studioRoot])
  const [activeContext, setActiveContext] = useState<AgentContext>(() =>
    historyScope === "studio" ? homeContext : (getAgentContext() ?? checkingContext()),
  )
  const activeContextRef = useRef(activeContext)
  const [contextRevision, setContextRevision] = useState(0)
  const directory = activeContext.directory
  const contextWritable = Boolean(directory && (activeContext.status === "available" || activeContext.status === "moved"))
  const readDirectory = contextWritable ? directory : activeContext.status === "missing" ? studioRoot : undefined

  const [healthOk, setHealthOk] = useState(available)
  const [healthError, setHealthError] = useState<string | undefined>()
  const [sseState, setSseState] = useState<"open" | "retry" | "closed">("closed")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [sessions, setSessions] = useState<StudioSessionHistoryItem[]>([])
  const [sessionID, setSessionID] = useState<string | undefined>()
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraft] = useState("")
  const [chips, setChips] = useState<ComposerChip[]>([])
  const composerStateRef = useRef<ComposerState>({ draft, chips })
  composerStateRef.current = { draft, chips }
  const composersBySession = useRef(new Map<string, ComposerState>())
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({})
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [files, setFiles] = useState<SnapshotFileDiff[]>([])
  const [modelOptions, setModelOptions] = useState<ModelRef[]>([])
  const [model, setModel] = useState<ModelRef | undefined>()
  const [variantsByModel, setVariantsByModel] = useState<Record<string, string>>({})
  const [catalogDirectory, setCatalogDirectory] = useState<string | undefined>()
  const [popover, setPopover] = useState<PopoverKind>(null)
  const [sessionQuery, setSessionQuery] = useState("")
  const [modelQuery, setModelQuery] = useState("")
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const contextEpoch = useRef(0)
  const historyRequest = useRef(0)
  const catalogRequest = useRef(0)
  const runtimeRequest = useRef(0)
  const messageRequest = useRef(0)
  const diffRequest = useRef(0)
  const pendingSession = useRef<PendingSession | undefined>(undefined)
  const pendingHandoff = useRef<AgentHandoffRequest | undefined>(undefined)
  const sessionIDRef = useRef(sessionID)
  const openRef = useRef(open)
  const busy =
    sending || Boolean(sessionID && (sessionStatuses[sessionID]?.type === "busy" || sessionStatuses[sessionID]?.type === "retry"))
  const permission = permissions.find((item) => item.sessionID === sessionID) ?? null
  const modelVariants = model?.variants ?? []
  const selectedVariant = model ? variantsByModel[modelKey(model)] : undefined
  const variant = selectedVariant && modelVariants.includes(selectedVariant) ? selectedVariant : undefined

  const saveComposer = useCallback(() => {
    if (!directory) return
    composersBySession.current.set(composerKey(activeContext.key, directory, sessionID), { draft, chips })
  }, [activeContext.key, chips, directory, draft, sessionID])

  const applyHandoff = useCallback((handoff: AgentHandoffRequest) => {
    setChips(handoffChips(handoff))
    setDraft(handoff.text.trim())
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  const transitionContext = useCallback(
    (next: AgentContext, targetSession?: PendingSession, handoff?: AgentHandoffRequest) => {
      saveComposer()
      pendingSession.current = targetSession
      pendingHandoff.current = handoff
      activeContextRef.current = next
      setActiveContext(next)
      setContextRevision((current) => current + 1)
    },
    [saveComposer],
  )

  const syncClaimedContext = useEffectEvent((next: AgentContext) => transitionContext(next))

  useEffect(() => {
    if (historyScope === "studio") return
    const sync = () => {
      syncClaimedContext(getAgentContext() ?? checkingContext())
    }
    sync()
    return subscribeAgentContext(sync)
  }, [historyScope])

  useLayoutEffect(() => {
    void contextRevision
    contextEpoch.current += 1
    historyRequest.current += 1
    catalogRequest.current += 1
    runtimeRequest.current += 1
    messageRequest.current += 1
    diffRequest.current += 1
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = undefined
    }
    if (historyScope === "directory") setSessions([])
    setMessages([])
    setFiles([])
    setSessionStatuses({})
    setPermissions([])
    setSending(false)
    setModelOptions([])
    setModel(undefined)
    setCatalogDirectory(undefined)
    setPopover(null)
    setSessionQuery("")
    setError(undefined)

    const target = pendingSession.current?.directory === directory ? pendingSession.current : undefined
    pendingSession.current = undefined
    const nextSessionID = target?.id
    sessionIDRef.current = nextSessionID
    setSessionID(nextSessionID)
    const composer = directory ? composersBySession.current.get(composerKey(activeContext.key, directory, nextSessionID)) : undefined
    const handoff = pendingHandoff.current
    pendingHandoff.current = undefined
    if (handoff) {
      applyHandoff(handoff)
    } else {
      setDraft(composer?.draft ?? "")
      setChips(composer?.chips ?? [])
    }
  }, [activeContext.key, applyHandoff, contextRevision, directory, historyScope])

  useEffect(() => {
    widthRef.current = width
  }, [width])
  useEffect(() => {
    sessionIDRef.current = sessionID
  }, [sessionID])
  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    const onResize = () => {
      const max = viewportAgentWidthMax(window.innerWidth)
      setViewportMax(max)
      setWidth((current) => {
        const next = clampAgentWidth(current, window.innerWidth)
        widthRef.current = next
        return next
      })
    }
    window.addEventListener("resize", onResize)
    onResize()
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    if (!popover) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("[data-oc-popover]") || target?.closest("[data-oc-popover-trigger]")) return
      setPopover(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [popover])

  const refreshHealth = useCallback(async () => {
    if (!available) {
      setHealthOk(false)
      return
    }
    const health = await probeAgentHealth()
    setHealthOk(health.ok)
    setHealthError(health.error)
  }, [available])

  const refreshSessions = useCallback(async () => {
    if (!healthOk) return
    if (historyScope === "directory" && !directory) return
    const epoch = contextEpoch.current
    const request = ++historyRequest.current
    let response: Awaited<ReturnType<typeof listSessionHistory>>
    try {
      response = await listSessionHistory({
        scope: historyScope,
        directory: historyScope === "directory" ? directory : undefined,
        contextKey: historyScope === "directory" ? activeContextRef.current.key : undefined,
      })
    } catch (error) {
      if (epoch !== contextEpoch.current || request !== historyRequest.current) return
      throw error
    }
    if (epoch !== contextEpoch.current || request !== historyRequest.current) return
    const rows = response.sessions
    setSessions(rows)
    const selectedID = sessionIDRef.current
    const selected = selectedID ? rows.find((session) => session.id === selectedID) : undefined
    if (selected) {
      const nextContext = contextFromHistory(selected.context)
      if (!sameContext(activeContextRef.current, nextContext)) {
        transitionContext(nextContext, { id: selected.id, directory: selected.context.directory })
        return
      }
    }
    const current = sessionIDRef.current
    const hasNewComposer =
      current === undefined && (Boolean(composerStateRef.current.draft.trim()) || composerStateRef.current.chips.length > 0)
    const next =
      current && rows.some((session) => session.id === current)
        ? current
        : hasNewComposer
          ? undefined
          : rows.find(
              (session) =>
                session.context.key === activeContextRef.current.key && session.context.directory === activeContextRef.current.directory,
            )?.id
    if (current !== next && directory) {
      const contextKey = activeContextRef.current.key
      composersBySession.current.set(composerKey(contextKey, directory, current), composerStateRef.current)
      const composer = composersBySession.current.get(composerKey(contextKey, directory, next))
      setDraft(composer?.draft ?? "")
      setChips(composer?.chips ?? [])
    }
    sessionIDRef.current = next
    setSessionID(next)
  }, [directory, healthOk, historyScope, transitionContext])

  const refreshCatalog = useCallback(async () => {
    if (!healthOk || !directory || !contextWritable) return
    const epoch = contextEpoch.current
    const request = ++catalogRequest.current
    const prefs = readPrefs(directory)
    let providerData: Awaited<ReturnType<typeof listProviders>>
    try {
      providerData = await listProviders(directory)
    } catch (error) {
      if (epoch !== contextEpoch.current || request !== catalogRequest.current) return
      throw error
    }
    if (epoch !== contextEpoch.current || request !== catalogRequest.current) return
    const options: ModelRef[] = []
    for (const provider of providerData?.providers ?? []) {
      for (const [modelID, config] of Object.entries(provider.models ?? {})) {
        options.push({ providerID: provider.id, modelID, variants: availableModelVariants(config.variants) })
      }
    }
    setModelOptions(options)
    const defaultProviderModel = providerData?.default
      ? Object.entries(providerData.default).map(([providerID, modelID]) => ({ providerID, modelID }))[0]
      : undefined
    const findModel = (candidate?: ModelPreference) =>
      candidate ? options.find((option) => option.providerID === candidate.providerID && option.modelID === candidate.modelID) : undefined
    setModel(findModel(prefs.model) ?? findModel(defaultProviderModel) ?? options[0])
    setVariantsByModel(
      Object.fromEntries(
        Object.entries(prefs.variants ?? {}).filter(([key, value]) =>
          options.some((option) => modelKey(option) === key && option.variants.includes(value)),
        ),
      ),
    )
    setCatalogDirectory(directory)
  }, [contextWritable, directory, healthOk])

  const refreshMessages = useCallback(
    async (id: string) => {
      if (!readDirectory) return
      const epoch = contextEpoch.current
      const request = ++messageRequest.current
      let rows: AgentMessage[]
      try {
        rows = await listMessages(id, readDirectory)
      } catch (error) {
        if (epoch !== contextEpoch.current || request !== messageRequest.current || sessionIDRef.current !== id) return
        throw error
      }
      if (epoch !== contextEpoch.current || request !== messageRequest.current || sessionIDRef.current !== id) return
      setMessages(rows)
    },
    [readDirectory],
  )

  const refreshDiff = useCallback(
    async (id: string) => {
      if (!readDirectory) return
      const epoch = contextEpoch.current
      const request = ++diffRequest.current
      try {
        const diff = await sessionDiff(id, readDirectory)
        if (epoch === contextEpoch.current && request === diffRequest.current && sessionIDRef.current === id) setFiles(diff)
      } catch {
        if (epoch === contextEpoch.current && request === diffRequest.current && sessionIDRef.current === id) setFiles([])
      }
    },
    [readDirectory],
  )

  const refreshRuntimeState = useCallback(async () => {
    if (!healthOk || !directory || !contextWritable) return
    const epoch = contextEpoch.current
    const request = ++runtimeRequest.current
    let result: [Record<string, SessionStatus>, PermissionRequest[]]
    try {
      result = await Promise.all([listSessionStatuses(directory), listPendingPermissions(directory)])
    } catch (error) {
      if (epoch !== contextEpoch.current || request !== runtimeRequest.current) return
      throw error
    }
    const [statuses, pending] = result
    if (epoch !== contextEpoch.current || request !== runtimeRequest.current) return
    setSessionStatuses(statuses)
    setPermissions(pending)
  }, [contextWritable, directory, healthOk])

  const scheduleMessageRefresh = useCallback(
    (id: string) => {
      if (refreshTimer.current) return
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined
        void refreshMessages(id).catch(() => {})
      }, 300)
    },
    [refreshMessages],
  )

  useEffect(() => {
    void refreshHealth()
    const timer = setInterval(() => void refreshHealth(), 10_000)
    return () => clearInterval(timer)
  }, [refreshHealth])

  useEffect(() => {
    void contextRevision
    if (!open || !healthOk) return
    const epoch = contextEpoch.current
    setLoading(true)
    setError(undefined)
    void Promise.all([refreshSessions(), refreshCatalog()])
      .catch((err) => {
        if (epoch === contextEpoch.current) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (epoch === contextEpoch.current) setLoading(false)
      })
  }, [contextRevision, open, healthOk, refreshSessions, refreshCatalog])

  useEffect(() => {
    if (!open || !healthOk) return
    const timer = setInterval(() => void refreshSessions().catch(() => {}), 10_000)
    return () => clearInterval(timer)
  }, [healthOk, open, refreshSessions])

  useEffect(() => {
    void contextRevision
    if (!healthOk) return
    const epoch = contextEpoch.current
    void refreshRuntimeState().catch((err) => {
      if (epoch === contextEpoch.current) setError(err instanceof Error ? err.message : String(err))
    })
  }, [contextRevision, healthOk, refreshRuntimeState])

  useEffect(() => {
    void contextRevision
    if (!open || !sessionID || !healthOk) {
      setMessages([])
      setFiles([])
      return
    }
    const epoch = contextEpoch.current
    void Promise.all([refreshMessages(sessionID), refreshDiff(sessionID)]).catch((err) =>
      epoch === contextEpoch.current ? setError(err instanceof Error ? err.message : String(err)) : undefined,
    )
  }, [contextRevision, open, sessionID, healthOk, refreshMessages, refreshDiff])

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!healthOk || !directory || !contextWritable) return
    return subscribeAgentEvents(
      directory,
      (event) => {
        const activeSessionID = sessionIDRef.current
        if (event.type === "studio.sse.retry") {
          return
        }
        if (event.type === "permission.asked") {
          runtimeRequest.current += 1
          const next = event.properties as PermissionRequest
          setPermissions((current) => [...current.filter((item) => item.id !== next.id), next])
          return
        }
        if (event.type === "permission.replied") {
          runtimeRequest.current += 1
          const props = event.properties as { requestID?: string; permissionID?: string }
          const id = props.requestID || props.permissionID
          if (id) setPermissions((current) => current.filter((item) => item.id !== id))
          return
        }
        if (event.type === "session.status") {
          runtimeRequest.current += 1
          const props = event.properties as { sessionID?: string; status?: SessionStatus }
          if (props.sessionID && props.status) setSessionStatuses((current) => ({ ...current, [props.sessionID!]: props.status! }))
          return
        }
        if (event.type === "session.idle") {
          runtimeRequest.current += 1
          const props = event.properties as { sessionID?: string }
          if (props.sessionID) setSessionStatuses((current) => ({ ...current, [props.sessionID!]: { type: "idle" } }))
          if (props.sessionID && props.sessionID === activeSessionID && openRef.current) {
            void Promise.all([refreshMessages(props.sessionID), refreshDiff(props.sessionID)]).catch(() => {})
          }
          return
        }
        if (event.type === "file.edited") {
          const props = event.properties as { file?: string; path?: string }
          const p = props.file || props.path
          if (p) publishAgentFileEvent({ paths: [p], directory, sessionID: activeSessionID })
          return
        }
        if (event.type === "session.diff") {
          diffRequest.current += 1
          const props = event.properties as { sessionID?: string; diff?: SnapshotFileDiff[] }
          const diff = props.diff ?? []
          if (props.sessionID === activeSessionID) setFiles(diff)
          const paths = diff.map((item) => item.file).filter((file): file is string => Boolean(file))
          if (paths.length) publishAgentFileEvent({ paths, directory, sessionID: props.sessionID })
          return
        }
        if (event.type === "message.updated" || event.type === "message.part.updated" || event.type === "message.part.delta") {
          messageRequest.current += 1
          const props = event.properties as { info?: { sessionID?: string }; part?: { sessionID?: string } }
          const eventSessionID = props.info?.sessionID || props.part?.sessionID
          if (openRef.current && activeSessionID && (!eventSessionID || eventSessionID === activeSessionID))
            scheduleMessageRefresh(activeSessionID)
          return
        }
        if (event.type === "session.updated") void refreshSessions().catch(() => {})
      },
      {
        onConnectionChange: (state) => {
          setSseState(state)
          if (state === "open") void refreshRuntimeState().catch(() => {})
        },
      },
    )
  }, [contextWritable, healthOk, directory, scheduleMessageRefresh, refreshSessions, refreshRuntimeState, refreshMessages, refreshDiff])

  useEffect(() => {
    return subscribeAgentHandoff(
      (request) => {
        const requestedDirectory = request.directory?.trim() || directory
        const claimed = getAgentContext()
        const fromHistory = sessions.find((session) => session.context.directory === requestedDirectory)?.context
        const next =
          requestedDirectory === studioRoot
            ? homeContext
            : claimed && claimed.directory === requestedDirectory
              ? claimed
              : fromHistory
                ? contextFromHistory(fromHistory)
                : activeContext
        if (sameContext(activeContextRef.current, next)) {
          saveComposer()
          applyHandoff(request)
          return true
        }
        transitionContext(next, undefined, request)
        return true
      },
      { consumer: true },
    )
  }, [activeContext, applyHandoff, directory, homeContext, saveComposer, sessions, studioRoot, transitionContext])

  useEffect(() => {
    if (!open || !mdUp || fullPage) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      if (popover) {
        setPopover(null)
        return
      }
      event.preventDefault()
      onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, mdUp, fullPage, onClose, popover])

  useFocusTrap(open && !mdUp && !fullPage, panelRef, onClose)

  // Auto-scroll only when the user is already at (near) the bottom — never yank mid-read.
  useEffect(() => {
    const el = listRef.current
    if (!el || !stickToBottom.current) return
    el.scrollTop = el.scrollHeight
  })

  const onThreadScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
  }, [])

  const status = deriveAgentStatus({
    open,
    available: available && healthOk,
    loading: open && available && loading,
    error: open && available && Boolean(error || (!healthOk && healthError)),
  })

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  useEffect(() => {
    if (!directory || catalogDirectory !== directory) return
    writePrefs(directory, {
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      variants: variantsByModel,
    })
  }, [directory, catalogDirectory, model, variantsByModel])

  const switchSession = useCallback(
    (nextSessionID: string, empty = false) => {
      if (!directory) return
      composersBySession.current.set(composerKey(activeContext.key, directory, sessionID), { draft, chips })
      const nextComposer = empty ? undefined : composersBySession.current.get(composerKey(activeContext.key, directory, nextSessionID))
      messageRequest.current += 1
      diffRequest.current += 1
      sessionIDRef.current = nextSessionID
      setSessionID(nextSessionID)
      setDraft(nextComposer?.draft ?? "")
      setChips(nextComposer?.chips ?? [])
    },
    [activeContext.key, chips, directory, draft, sessionID],
  )

  const ensureSession = useCallback(async () => {
    if (sessionID) return sessionID
    if (!directory || !contextWritable) throw new Error("Agent context is unavailable")
    const epoch = contextEpoch.current
    const created = await createSession(directory, contextMetadata(activeContext))
    if (epoch !== contextEpoch.current) throw new Error("Agent context changed")
    historyRequest.current += 1
    setSessions((prev) => [historyItem(created, activeContext), ...prev])
    sessionIDRef.current = created.id
    setSessionID(created.id)
    return created.id
  }, [activeContext, contextWritable, directory, sessionID])

  const composeOutbound = () => {
    const pieces: string[] = []
    for (const chip of chips) {
      if (chip.kind === "path") pieces.push(`@${chip.value}`)
      else pieces.push(chip.value)
    }
    if (draft.trim()) pieces.push(draft.trim())
    return pieces.join("\n\n")
  }

  const onSend = async () => {
    const text = composeOutbound()
    const sendDirectory = directory
    if (!text || busy || !contextWritable || !sendDirectory) return
    const epoch = contextEpoch.current
    setError(undefined)
    setSending(true)
    stickToBottom.current = true
    let activeID = sessionID
    try {
      activeID = await ensureSession()
      runtimeRequest.current += 1
      setSessionStatuses((current) => ({ ...current, [activeID!]: { type: "busy" } }))
      await promptSessionAsync({
        sessionID: activeID,
        text,
        directory: sendDirectory,
        model,
        variant,
      })
      if (epoch === contextEpoch.current) {
        setDraft("")
        setChips([])
        await refreshMessages(activeID)
      }
    } catch (err) {
      if (epoch === contextEpoch.current) {
        setError(err instanceof Error ? err.message : String(err))
        if (activeID) {
          runtimeRequest.current += 1
          setSessionStatuses((current) => ({ ...current, [activeID!]: { type: "idle" } }))
        }
      }
    } finally {
      if (epoch === contextEpoch.current) setSending(false)
    }
  }

  const onNewSession = async () => {
    if (!directory || !contextWritable) return
    const epoch = contextEpoch.current
    setError(undefined)
    setPopover(null)
    try {
      const created = await createSession(directory, contextMetadata(activeContext))
      if (epoch !== contextEpoch.current) return
      historyRequest.current += 1
      setSessions((prev) => [historyItem(created, activeContext), ...prev])
      switchSession(created.id, true)
      setMessages([])
      setFiles([])
      composerRef.current?.focus()
    } catch (err) {
      if (epoch === contextEpoch.current) setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onAbort = async () => {
    if (!sessionID || !directory || !contextWritable) return
    try {
      await abortSession(sessionID, directory)
      setSending(false)
      runtimeRequest.current += 1
      setSessionStatuses((current) => ({ ...current, [sessionID]: { type: "idle" } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onPermission = async (response: "once" | "always" | "reject") => {
    if (!permission || !directory || !contextWritable) return
    try {
      await replyPermission({
        requestID: permission.id,
        reply: response,
        directory,
      })
      runtimeRequest.current += 1
      setPermissions((current) => current.filter((item) => item.id !== permission.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const startX = event.clientX
    const startW = widthRef.current
    setDragging(true)
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // optional
    }
    const onMove = (moveEvent: PointerEvent) => {
      const next = clampAgentWidth(startW + (moveEvent.clientX - startX), window.innerWidth)
      widthRef.current = next
      setWidth(next)
    }
    const onUp = (upEvent: PointerEvent) => {
      setDragging(false)
      writeAgentWidth(widthRef.current)
      try {
        target.releasePointerCapture(upEvent.pointerId)
      } catch {
        // ignore
      }
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointercancel", onUp)
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", onUp)
    target.addEventListener("pointercancel", onUp)
  }

  const shellClass = fullPage
    ? "oc-panel oc-panel--page flex min-h-0 min-w-0 flex-1 flex-col"
    : `${open ? "flex" : "hidden"} oc-panel absolute inset-0 z-30 min-h-0 w-full flex-col md:static md:inset-auto md:shrink-0 ${dragging ? "select-none" : ""}`
  const mobileDialog = !fullPage && open && !mdUp
  const Panel = mobileDialog ? "div" : "aside"

  const activeSession = sessions.find((s) => s.id === sessionID)
  const sessionTitle = activeSession ? sessionLabel(activeSession) : sessionID ? sessionID.slice(0, 8) : "New session"
  const optionLabels = useMemo(() => sessionOptionLabels(sessions), [sessions])

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLocaleLowerCase()
    return q
      ? sessions.filter((s) =>
          `${s.title || s.id}\n${optionLabels.get(s.id) ?? ""}\n${s.context.label}\n${s.context.relativePath ?? ""}`
            .toLocaleLowerCase()
            .includes(q),
        )
      : sessions
  }, [sessions, sessionQuery, optionLabels])
  const sessionGroups = useMemo(() => sessionGroupsByLastMessage(filteredSessions), [filteredSessions])

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase()
    const rows = q ? modelOptions.filter((m) => modelKey(m).toLowerCase().includes(q) || m.modelID.toLowerCase().includes(q)) : modelOptions
    return rows.slice(0, MODEL_UI_LIMIT)
  }, [modelOptions, modelQuery])

  const filePaths = useMemo(() => {
    const paths = new Set<string>()
    for (const d of files) if (d.file) paths.add(d.file)
    return [...paths]
  }, [files])

  const activeContextLink = contextLink(activeContext)
  const canSend = Boolean(composeOutbound()) && !busy && contextWritable
  const statusLabel =
    !available || !healthOk
      ? healthError || "Unavailable"
      : busy
        ? "Working"
        : sseState === "retry"
          ? "Reconnecting…"
          : loading
            ? "Loading…"
            : "Ready"

  return (
    <Panel
      ref={setPanelRef}
      aria-label="Agent"
      role={mobileDialog ? "dialog" : undefined}
      aria-modal={mobileDialog ? true : undefined}
      data-agent-open={open || fullPage ? "true" : "false"}
      data-agent-width={width}
      className={shellClass}
      style={!fullPage && open && mdUp ? { width, minWidth: AGENT_WIDTH_MIN, maxWidth: viewportMax } : undefined}
    >
      <header className="oc-panel__header">
        <span className={`oc-panel__dot ${agentStatusDotClass(status)}`} aria-hidden />
        <div className="oc-panel__title-wrap">
          <button
            type="button"
            data-oc-popover-trigger
            className="oc-panel__session-btn"
            onClick={() => setPopover((p) => (p === "session" ? null : "session"))}
            aria-expanded={popover === "session"}
            title={sessionTitle}
          >
            <span className="oc-panel__session-title">{sessionTitle}</span>
            <IconChevron />
          </button>
          <p className="oc-panel__sub" title={directory}>
            {activeContext.label} ·{" "}
            {activeContext.status === "checking"
              ? "Loading…"
              : activeContext.status === "missing"
                ? "Unavailable"
                : activeContext.status === "moved"
                  ? `Moved · ${statusLabel}`
                  : statusLabel}
          </p>
        </div>
        {fullPage && activeContextLink ? (
          <Link className="oc-context-link" to={activeContextLink.href}>
            {activeContextLink.label}
          </Link>
        ) : null}
        {fullPage && activeContext.key !== "home" ? (
          <button
            type="button"
            className="oc-icon-btn"
            onClick={() => transitionContext(homeContext)}
            aria-label="Return to Studio Home"
            title="Return to Studio Home"
          >
            <IconHome />
          </button>
        ) : null}
        <button
          type="button"
          className="oc-icon-btn"
          onClick={() => void onNewSession()}
          aria-label="New session"
          title="New session"
          disabled={!contextWritable}
        >
          <IconPlus />
        </button>
        {sessionID && busy ? (
          <button type="button" className="oc-icon-btn oc-icon-btn--warn" onClick={() => void onAbort()} aria-label="Stop" title="Stop">
            <IconStop />
          </button>
        ) : null}
        {!fullPage ? (
          <button type="button" data-autofocus className="oc-icon-btn" onClick={onClose} aria-label="Close agent" title="Close">
            <IconClose />
          </button>
        ) : null}
      </header>

      {popover === "session" ? (
        <div className="oc-popover oc-popover--session" data-oc-popover role="listbox" aria-label="Sessions">
          <input
            className="oc-popover__search"
            placeholder="Search sessions…"
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
          />
          <div className="oc-popover__list">
            {sessionGroups.map((group) => (
              <fieldset key={group.key} className="oc-popover__group">
                <legend className="oc-popover__group-label">{group.label}</legend>
                {group.sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={s.id === sessionID}
                    className={`oc-popover__item ${s.id === sessionID ? "is-active" : ""}`}
                    onClick={() => {
                      const nextContext = contextFromHistory(s.context)
                      if (historyScope === "studio" && !sameContext(nextContext, activeContextRef.current)) {
                        transitionContext(nextContext, { id: s.id, directory: s.context.directory })
                      } else {
                        switchSession(s.id)
                      }
                      setPopover(null)
                      setSessionQuery("")
                    }}
                  >
                    <span className="truncate">{optionLabels.get(s.id) ?? sessionLabel(s)}</span>
                    {historyScope === "studio" ? (
                      <span className="oc-popover__meta">
                        {s.context.label}
                        {s.context.relativePath && s.context.relativePath !== s.context.projectId ? ` · ${s.context.relativePath}` : ""}
                        {s.context.status === "missing" ? " · unavailable" : s.context.status === "moved" ? " · moved" : ""}
                      </span>
                    ) : null}
                  </button>
                ))}
              </fieldset>
            ))}
            {filteredSessions.length === 0 ? <p className="oc-popover__empty">No sessions</p> : null}
          </div>
        </div>
      ) : null}

      {!available || !healthOk ? (
        <div className="oc-panel__empty">
          <p className="oc-panel__empty-title">Agent API unavailable</p>
          <p className="oc-panel__empty-body">
            Start with <code>opencode-studio up</code>. {healthError ? <span className="font-mono text-[11px]">{healthError}</span> : null}
          </p>
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void refreshHealth()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="oc-panel__body">
          {filePaths.length > 0 ? (
            <div className="oc-files">
              <span className="oc-files__label">Files</span>
              {filePaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="oc-chip"
                  title={path}
                  onClick={() => {
                    setChips((prev) =>
                      prev.some((c) => c.kind === "path" && c.value === path)
                        ? prev
                        : [...prev, { id: `path:${path}`, kind: "path", value: path, label: path.split("/").pop() || path }],
                    )
                  }}
                >
                  {path.split("/").pop() || path}
                </button>
              ))}
            </div>
          ) : null}

          <div ref={listRef} className="oc-thread" onScroll={onThreadScroll}>
            <div className="oc-thread__inner">
              {loading ? <p className="oc-thread__hint">Loading…</p> : null}
              {!loading && messages.length === 0 ? (
                <div className="oc-thread__welcome">
                  <h2>{sessionTitle === "New session" || !activeSession ? "New session" : sessionTitle}</h2>
                  <p>Ask anything. Studio handoffs land in the composer below.</p>
                </div>
              ) : null}
              {messages.map((message) => (
                <MessageBubble key={message.info.id} message={message} />
              ))}
            </div>
          </div>

          {permission ? (
            <div className="oc-permission" role="alertdialog" aria-label="Permission request">
              <p className="oc-permission__title">{permission.permission}</p>
              <p className="oc-permission__meta">{permission.patterns.join(", ") || "OpenCode requests permission to continue."}</p>
              <div className="oc-permission__actions">
                <button type="button" className="oc-chip" onClick={() => void onPermission("once")}>
                  Allow once
                </button>
                <button type="button" className="oc-chip" onClick={() => void onPermission("always")}>
                  Always
                </button>
                <button type="button" className="oc-chip" onClick={() => void onPermission("reject")}>
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="oc-error" role="alert">
              {error}
            </div>
          ) : null}

          {!contextWritable ? (
            <div className="oc-error" role="status">
              {activeContext.status === "checking"
                ? "Resolving the active Studio context…"
                : "This session's project directory is unavailable. The conversation is read-only."}
              {fullPage && activeContext.key !== "home" ? (
                <button type="button" className="ml-2 underline" onClick={() => transitionContext(homeContext)}>
                  Return Home
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="oc-composer-wrap">
            <div className="oc-composer-inner">
              {chips.length > 0 ? (
                <div className="oc-composer__chips">
                  {chips.map((chip) => (
                    <span key={chip.id} className={`oc-chip ${chip.kind === "annotation" ? "oc-chip--ann" : ""}`} title={chip.value}>
                      {chip.kind === "annotation" ? "◎ " : "@"}
                      {chip.label}
                      <button
                        type="button"
                        aria-label={`Remove ${chip.label}`}
                        onClick={() => setChips((prev) => prev.filter((c) => c.id !== chip.id))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <form
                className="oc-dock"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (busy) {
                    void onAbort()
                    return
                  }
                  void onSend()
                }}
              >
                <textarea
                  ref={composerRef}
                  className="oc-dock__input"
                  placeholder="Ask anything…"
                  value={draft}
                  disabled={busy || !contextWritable}
                  rows={2}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void onSend()
                    }
                  }}
                />
                <div className="oc-dock__bar">
                  <div className="oc-dock__left">
                    <button
                      type="button"
                      data-oc-popover-trigger
                      className="oc-dock__model oc-dock__model--primary"
                      disabled={!contextWritable}
                      onClick={() => setPopover((p) => (p === "model" ? null : "model"))}
                      aria-expanded={popover === "model"}
                      title={model ? modelKey(model) : "Model"}
                    >
                      <span className="truncate">{model ? modelLabel(model) : "Model"}</span>
                      <IconChevron />
                    </button>
                    {popover === "model" ? (
                      <div className="oc-popover oc-popover--model" data-oc-popover role="listbox" aria-label="Models">
                        <input
                          className="oc-popover__search"
                          placeholder="Search models…"
                          value={modelQuery}
                          onChange={(e) => setModelQuery(e.target.value)}
                        />
                        <div className="oc-popover__list">
                          {filteredModels.map((m) => (
                            <button
                              key={modelKey(m)}
                              type="button"
                              role="option"
                              aria-selected={model ? modelKey(model) === modelKey(m) : false}
                              className={`oc-popover__item ${model && modelKey(model) === modelKey(m) ? "is-active" : ""}`}
                              onClick={() => {
                                setModel(m)
                                setPopover(null)
                                setModelQuery("")
                              }}
                            >
                              <span className="truncate font-medium">{m.modelID}</span>
                              <span className="oc-popover__meta">{m.providerID}</span>
                            </button>
                          ))}
                          {filteredModels.length === 0 ? <p className="oc-popover__empty">No models</p> : null}
                        </div>
                      </div>
                    ) : null}
                    {modelVariants.length > 0 ? (
                      <button
                        type="button"
                        data-oc-popover-trigger
                        className="oc-dock__model oc-dock__model--variant"
                        disabled={!contextWritable}
                        onClick={() => setPopover((p) => (p === "variant" ? null : "variant"))}
                        aria-expanded={popover === "variant"}
                        aria-label={`Reasoning effort: ${modelVariantLabel(variant ?? "")}`}
                        title={`Reasoning effort: ${modelVariantLabel(variant ?? "")}`}
                      >
                        <span className="truncate">{modelVariantLabel(variant ?? "")}</span>
                        <IconChevron />
                      </button>
                    ) : null}
                    {popover === "variant" && model ? (
                      <div className="oc-popover oc-popover--model" data-oc-popover role="listbox" aria-label="Reasoning effort">
                        <div className="oc-popover__list">
                          <button
                            type="button"
                            role="option"
                            aria-selected={!variant}
                            className={`oc-popover__item ${!variant ? "is-active" : ""}`}
                            onClick={() => {
                              setVariantsByModel((current) => {
                                const next = { ...current }
                                delete next[modelKey(model)]
                                return next
                              })
                              setPopover(null)
                            }}
                          >
                            <span className="truncate font-medium">Default</span>
                            <span className="oc-popover__meta">Model default</span>
                          </button>
                          {modelVariants.map((option) => (
                            <button
                              key={option}
                              type="button"
                              role="option"
                              aria-selected={variant === option}
                              className={`oc-popover__item ${variant === option ? "is-active" : ""}`}
                              onClick={() => {
                                setVariantsByModel((current) => ({ ...current, [modelKey(model)]: option }))
                                setPopover(null)
                              }}
                            >
                              <span className="truncate font-medium">{modelVariantLabel(option)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <button type="submit" className="oc-dock__send" disabled={!canSend && !busy} aria-label={busy ? "Stop" : "Send"}>
                    {busy ? <IconStop /> : <IconSend />}
                  </button>
                </div>
              </form>
              <p className="oc-dock__dir" title={directory}>
                {directory ?? "Resolving context…"}
              </p>
            </div>
          </div>
        </div>
      )}

      {!fullPage && open && mdUp ? (
        // biome-ignore lint/a11y/useSemanticElements: vertical drag handle
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agent panel"
          aria-valuenow={width}
          aria-valuemin={AGENT_WIDTH_MIN}
          aria-valuemax={viewportMax}
          tabIndex={0}
          className="oc-panel__resize"
          onPointerDown={(event) => {
            event.preventDefault()
            beginResize(event)
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              const next = clampAgentWidth(width - 16, window.innerWidth)
              setWidth(next)
              writeAgentWidth(next)
            } else if (event.key === "ArrowRight") {
              event.preventDefault()
              const next = clampAgentWidth(width + 16, window.innerWidth)
              setWidth(next)
              writeAgentWidth(next)
            }
          }}
        />
      ) : null}
    </Panel>
  )
}
