import type { PermissionRequest, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
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
import type { StudioSessionHistoryItem } from "../../src/core/session-history"
import { type AgentContext, getAgentContext, homeAgentContext, subscribeAgentContext } from "../agent-context"
import { type AgentHandoffRequest, subscribeAgentHandoff } from "../agent-handoff"
import { type AgentStatus, deriveAgentStatus } from "../agent-status"
import { AGENT_WIDTH_MAX, AGENT_WIDTH_MIN, clampAgentWidth, readAgentWidth, viewportAgentWidthMax, writeAgentWidth } from "../agent-width"
import { Button } from "../components/button"
import { useFocusTrap } from "../lib/focus-trap"
import { AgentComposer } from "./agent-composer"
import { publishAgentFileEvent } from "./agent-file-events"
import { MessageBubble } from "./agent-messages"
import { AgentPanelHeader } from "./agent-panel-header"
import {
  type ComposerChip,
  type ComposerState,
  checkingContext,
  composeOutbound,
  composerKey,
  contextLink,
  contextMetadata,
  handoffChips,
  historyItem,
  MODEL_UI_LIMIT,
  type ModelPreference,
  type ModelRef,
  modelKey,
  type PendingSession,
  type PopoverKind,
  readPrefs,
  sameContext,
  writePrefs,
} from "./agent-types"
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
import { availableModelVariants } from "./model-variant"
import { PermissionRequestBar } from "./permission-request"
import { SessionHistoryPopover } from "./session-history-popover"
import { sessionGroupsByLastMessage, sessionLabel, sessionOptionLabels } from "./session-label"
import {
  appendMessageSample,
  appendStreamSample,
  estimateStreamTokens,
  finalOutputTps,
  formatUsageLine,
  liveTpsValue,
  pruneStreamSamples,
  type StreamSample,
  sessionUsageTotals,
  type UsageMessage,
} from "./session-usage"

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
  const [streamSamples, setStreamSamples] = useState<StreamSample[]>([])
  const [messageSamples, setMessageSamples] = useState<Record<string, StreamSample[]>>({})
  const activeMessageCharsRef = useRef<{ messageID: string; chars: number } | undefined>(undefined)
  const [usageClock, setUsageClock] = useState(() => Date.now())
  const busy =
    sending || Boolean(sessionID && (sessionStatuses[sessionID]?.type === "busy" || sessionStatuses[sessionID]?.type === "retry"))
  const permission = permissions.find((item) => item.sessionID === sessionID) ?? null
  const modelVariants = model?.variants ?? []
  const selectedVariant = model ? variantsByModel[modelKey(model)] : undefined
  const variant = selectedVariant && modelVariants.includes(selectedVariant) ? selectedVariant : undefined

  const saveComposer = useCallback(() => {
    if (!directory) return
    // Read draft/chips from ref so keystrokes do not rebuild this callback
    // (and the refreshSessions → setLoading chain that depends on it).
    composersBySession.current.set(composerKey(activeContext.key, directory, sessionID), composerStateRef.current)
  }, [activeContext.key, directory, sessionID])

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
    setStreamSamples([])
    setMessageSamples({})
    activeMessageCharsRef.current = undefined

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
      const nextContext = selected.context as AgentContext
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

  const refreshSessionsRef = useRef(refreshSessions)
  refreshSessionsRef.current = refreshSessions
  const refreshCatalogRef = useRef(refreshCatalog)
  refreshCatalogRef.current = refreshCatalog

  useEffect(() => {
    void contextRevision
    if (!open || !healthOk) return
    const epoch = contextEpoch.current
    setLoading(true)
    setError(undefined)
    // Call through refs so draft/session callback identity churn cannot re-trigger Loading.
    void Promise.all([refreshSessionsRef.current(), refreshCatalogRef.current()])
      .catch((err) => {
        if (epoch === contextEpoch.current) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (epoch === contextEpoch.current) setLoading(false)
      })
  }, [contextRevision, open, healthOk])

  useEffect(() => {
    if (!open || !healthOk) return
    const timer = setInterval(() => void refreshSessionsRef.current().catch(() => {}), 10_000)
    return () => clearInterval(timer)
  }, [healthOk, open])

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
    if (!busy) return
    setUsageClock(Date.now())
    const timer = setInterval(() => {
      const now = Date.now()
      setUsageClock(now)
      setStreamSamples((samples) => pruneStreamSamples(samples, now))
    }, 1_000)
    return () => clearInterval(timer)
  }, [busy])

  useEffect(() => {
    // Reset TPS samples whenever the active session identity changes.
    void sessionID
    setStreamSamples([])
    setMessageSamples({})
    activeMessageCharsRef.current = undefined
  }, [sessionID])

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
          if (props.sessionID && props.sessionID === activeSessionID) {
            setStreamSamples((samples) => pruneStreamSamples(samples))
            activeMessageCharsRef.current = undefined
            if (openRef.current) void Promise.all([refreshMessages(props.sessionID), refreshDiff(props.sessionID)]).catch(() => {})
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
        if (event.type === "message.part.delta") {
          messageRequest.current += 1
          const props = event.properties as {
            sessionID?: string
            messageID?: string
            field?: string
            delta?: string
          }
          if (openRef.current && activeSessionID && (!props.sessionID || props.sessionID === activeSessionID)) {
            scheduleMessageRefresh(activeSessionID)
          }
          if (
            props.field === "text" &&
            props.messageID &&
            typeof props.delta === "string" &&
            props.delta.length > 0 &&
            activeSessionID &&
            (!props.sessionID || props.sessionID === activeSessionID)
          ) {
            const messageID = props.messageID
            const previous = activeMessageCharsRef.current
            const previousChars = previous?.messageID === messageID ? previous.chars : 0
            const nextChars = previousChars + props.delta.length
            activeMessageCharsRef.current = { messageID, chars: nextChars }
            const deltaTokens = Math.max(0, estimateStreamTokens(nextChars) - estimateStreamTokens(previousChars))
            if (deltaTokens > 0) {
              const sample = { at: Date.now(), tokens: deltaTokens }
              setStreamSamples((samples) => appendStreamSample(samples, sample))
              setMessageSamples((stats) => appendMessageSample(stats, messageID, sample))
            }
          }
          return
        }
        if (event.type === "message.updated" || event.type === "message.part.updated") {
          messageRequest.current += 1
          const props = event.properties as {
            info?: { sessionID?: string; role?: string; time?: { completed?: number } }
            part?: { sessionID?: string }
          }
          const eventSessionID = props.info?.sessionID || props.part?.sessionID
          if (openRef.current && activeSessionID && (!eventSessionID || eventSessionID === activeSessionID))
            scheduleMessageRefresh(activeSessionID)
          if (props.info?.role === "assistant" && props.info.time?.completed) {
            setStreamSamples((samples) => pruneStreamSamples(samples, props.info!.time!.completed))
            activeMessageCharsRef.current = undefined
          }
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
                ? (fromHistory as AgentContext)
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
      composersBySession.current.set(composerKey(activeContext.key, directory, sessionID), composerStateRef.current)
      const nextComposer = empty ? undefined : composersBySession.current.get(composerKey(activeContext.key, directory, nextSessionID))
      messageRequest.current += 1
      diffRequest.current += 1
      sessionIDRef.current = nextSessionID
      setSessionID(nextSessionID)
      setDraft(nextComposer?.draft ?? "")
      setChips(nextComposer?.chips ?? [])
    },
    [activeContext.key, directory, sessionID],
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

  const onSend = async () => {
    const text = composeOutbound(chips, draft)
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

  const usageMessages = useMemo((): UsageMessage[] => {
    return messages.map((message) => {
      const info = message.info
      if (info.role === "assistant") {
        return {
          role: "assistant",
          id: info.id,
          parentID: info.parentID,
          cost: info.cost,
          tokens: info.tokens,
          time: info.time,
        }
      }
      return {
        role: info.role,
        id: info.id,
        time: { created: info.time.created },
      }
    })
  }, [messages])

  const usageLine = useMemo(() => {
    void usageClock
    const totals = sessionUsageTotals(usageMessages)
    return formatUsageLine({
      busy,
      liveTps: busy ? liveTpsValue(streamSamples, usageClock) : undefined,
      finalTps: finalOutputTps(usageMessages, messageSamples),
      tokens: totals.tokens,
      cost: totals.cost,
    })
  }, [busy, messageSamples, streamSamples, usageClock, usageMessages])

  const activeContextLink = contextLink(activeContext)
  const canSend = Boolean(composeOutbound(chips, draft)) && !busy && contextWritable
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
      <AgentPanelHeader
        status={status}
        sessionTitle={sessionTitle}
        directory={directory}
        activeContext={activeContext}
        statusLabel={statusLabel}
        activeContextLink={activeContextLink}
        fullPage={fullPage}
        contextWritable={contextWritable}
        sessionID={sessionID}
        busy={busy}
        popoverSessionOpen={popover === "session"}
        onToggleSessionPopover={() => setPopover((p) => (p === "session" ? null : "session"))}
        onHome={() => transitionContext(homeContext)}
        onNewSession={() => void onNewSession()}
        onAbort={() => void onAbort()}
        onClose={onClose}
      />

      {popover === "session" ? (
        <SessionHistoryPopover
          sessionGroups={sessionGroups}
          optionLabels={optionLabels}
          sessionID={sessionID}
          sessionQuery={sessionQuery}
          onQueryChange={setSessionQuery}
          historyScope={historyScope}
          onSelect={(s) => {
            const nextContext = s.context as AgentContext
            if (historyScope === "studio" && !sameContext(nextContext, activeContextRef.current)) {
              transitionContext(nextContext, { id: s.id, directory: s.context.directory })
            } else {
              switchSession(s.id)
            }
            setPopover(null)
            setSessionQuery("")
          }}
        />
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

          {permission ? <PermissionRequestBar permission={permission} onReply={(reply) => void onPermission(reply)} /> : null}

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

          <AgentComposer
            composerRef={composerRef}
            draft={draft}
            onDraftChange={setDraft}
            chips={chips}
            onRemoveChip={(id) => setChips((prev) => prev.filter((c) => c.id !== id))}
            busy={busy}
            contextWritable={contextWritable}
            canSend={canSend}
            directory={directory}
            model={model}
            modelOptions={filteredModels}
            modelQuery={modelQuery}
            onModelQueryChange={setModelQuery}
            modelVariants={modelVariants}
            variant={variant}
            popover={popover}
            onPopoverChange={setPopover}
            onSelectModel={(m) => {
              setModel(m)
              setPopover(null)
              setModelQuery("")
            }}
            onSelectVariant={(option) => {
              if (!model) return
              setVariantsByModel((current) => ({ ...current, [modelKey(model)]: option }))
              setPopover(null)
            }}
            onClearVariant={() => {
              if (!model) return
              setVariantsByModel((current) => {
                const next = { ...current }
                delete next[modelKey(model)]
                return next
              })
              setPopover(null)
            }}
            onSend={() => void onSend()}
            onAbort={() => void onAbort()}
            usageLine={usageLine}
          />
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
