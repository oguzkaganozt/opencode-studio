import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

type Session = {
  id: string
  title: string
  time: { created: number; updated: number }
  metadata?: Record<string, unknown>
}

type MessagePart = {
  id: string
  type: string
  text?: string
  tool?: string
  state?: { status: string; title?: string; output?: string; error?: string }
}

type MessageEntry = {
  info: {
    id: string
    role: "user" | "assistant"
    time: { created: number; completed?: number }
    error?: { data?: { message?: string } }
  }
  parts: MessagePart[]
}

type Permission = {
  id: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
}

type Question = {
  id: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
    custom?: boolean
  }>
}

type ChatState = {
  messages: MessageEntry[]
  status: { type: string }
  permissions: Permission[]
  questions: Question[]
}

class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

function authorization(password: string) {
  if (!password) return undefined
  const bytes = new TextEncoder().encode(`opencode-studio:${password}`)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

async function chatJson<T>(url: string, password: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const auth = authorization(password)
  if (auth) headers.set("Authorization", auth)
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ChatError(body?.error?.message ?? `Request failed: ${response.status}`, response.status, body?.error?.code)
  }
  return response.json() as Promise<T>
}

function messageText(message: MessageEntry) {
  return message.parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
}

function QuestionCard({ request, disabled, onSubmit }: { request: Question; disabled: boolean; onSubmit: (answers: string[][]) => void }) {
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []))
  const choose = (questionIndex: number, label: string, multiple: boolean) => {
    setAnswers((current) =>
      current.map((answer, index) => {
        if (index !== questionIndex) return answer
        if (!multiple) return [label]
        return answer.includes(label) ? answer.filter((item) => item !== label) : [...answer, label]
      }),
    )
  }

  return (
    <div className="m-3 rounded-lg border border-[var(--osc-border-strong)] bg-[var(--osc-bg-elevated)] p-3">
      <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">Agent question</p>
      {request.questions.map((question, questionIndex) => (
        <div key={`${request.id}-${question.header}`} className="mb-3 last:mb-0">
          <p className="text-[12px] font-medium">{question.question}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {question.options.map((option) => {
              const selected = answers[questionIndex]?.includes(option.label)
              return (
                <button
                  key={option.label}
                  type="button"
                  title={option.description}
                  onClick={() => choose(questionIndex, option.label, Boolean(question.multiple))}
                  className={`rounded-md border px-2.5 py-1 text-[11px] ${
                    selected
                      ? "border-[var(--osc-text)] bg-[var(--osc-text)] text-[var(--osc-bg)]"
                      : "border-[var(--osc-border)] bg-[var(--osc-bg)] hover:border-[var(--osc-border-strong)]"
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          {question.custom && (
            <input
              type="text"
              placeholder="Type a custom answer"
              onChange={(event) => {
                const value = event.target.value.trim()
                setAnswers((current) => current.map((answer, index) => (index === questionIndex ? (value ? [value] : []) : answer)))
              }}
              className="mt-2 w-full rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg)] px-2.5 py-1.5 text-[11px]"
            />
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={disabled || answers.some((answer) => answer.length === 0)}
        onClick={() => onSubmit(answers)}
        className="mt-2 rounded-md bg-[var(--osc-primary)] px-3 py-1.5 text-[11px] font-medium text-[var(--osc-primary-fg)] disabled:opacity-35"
      >
        Send answer
      </button>
    </div>
  )
}

export function AgentPanel({
  studioId,
  studioLabel,
  csrfToken,
  open,
  onClose,
}: {
  studioId: string
  studioLabel: string
  csrfToken?: string
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState(() => sessionStorage.getItem("opencode-studio-agent-password") ?? "")
  const [passwordDraft, setPasswordDraft] = useState(password)
  const [sessionID, setSessionID] = useState(() => localStorage.getItem(`opencode-studio-session:${studioId}`) ?? "")
  const [prompt, setPrompt] = useState("")

  const sessionsQuery = useQuery({
    queryKey: ["chat", "sessions", password],
    queryFn: () => chatJson<{ sessions: Session[] }>("/api/chat/sessions", password),
    retry: false,
    enabled: open,
  })

  useEffect(() => {
    if (!sessionsQuery.data) return
    const studioSessions = sessionsQuery.data.sessions.filter((session) => session.metadata?.["opencode-studio"] === studioId)
    if (studioSessions.some((session) => session.id === sessionID)) return
    setSessionID(studioSessions[0]?.id ?? "")
  }, [sessionID, sessionsQuery.data, studioId])

  useEffect(() => {
    const key = `opencode-studio-session:${studioId}`
    if (sessionID) localStorage.setItem(key, sessionID)
    else localStorage.removeItem(key)
  }, [sessionID, studioId])

  const stateQuery = useQuery({
    queryKey: ["chat", "state", sessionID, password],
    queryFn: () => chatJson<ChatState>(`/api/chat/sessions/${encodeURIComponent(sessionID)}/state`, password),
    enabled: open && Boolean(sessionID),
    retry: false,
    refetchInterval: (query) => {
      const error = query.state.error as ChatError | null
      if (error?.status === 401 || error?.code === "chat_auth_required") return false
      if (error) return 3000
      return query.state.data?.status.type === "idle" ? 2500 : 800
    },
  })

  useEffect(() => {
    if (!stateQuery.data) return
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [stateQuery.data])

  const mutationHeaders = () => {
    if (!csrfToken) throw new Error("CSRF token unavailable")
    return { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }
  }

  const createSession = useMutation({
    mutationFn: () =>
      chatJson<Session>("/api/chat/sessions", password, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ title: studioLabel, studioId }),
      }),
    onSuccess: async (session) => {
      setSessionID(session.id)
      await queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] })
    },
  })

  const sendPrompt = useMutation({
    mutationFn: async (text: string) => {
      let id = sessionID
      if (!id) {
        const session = await chatJson<Session>("/api/chat/sessions", password, {
          method: "POST",
          headers: mutationHeaders(),
          body: JSON.stringify({ title: studioLabel, studioId }),
        })
        id = session.id
        setSessionID(id)
      }
      await chatJson(`/api/chat/sessions/${encodeURIComponent(id)}/prompts`, password, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ text }),
      })
      return id
    },
    onSuccess: async (id) => {
      setPrompt("")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["chat", "state", id] }),
      ])
    },
  })

  const action = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) =>
      chatJson(url, password, {
        method: "POST",
        headers: mutationHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat", "state", sessionID] }),
  })

  const savePassword = () => {
    sessionStorage.setItem("opencode-studio-agent-password", passwordDraft)
    setPassword(passwordDraft)
  }

  const queryError = (sessionsQuery.error || stateQuery.error) as ChatError | null
  const authNeeded = queryError?.status === 401
  const setupNeeded = queryError?.code === "chat_auth_required"
  const busy = stateQuery.data?.status.type === "busy" || stateQuery.data?.status.type === "retry"

  return (
    <aside
      aria-label="OpenCode agent"
      className={`${open ? "flex" : "hidden"} absolute inset-0 z-30 min-h-0 w-full flex-col border-r border-[var(--osc-border)] bg-[var(--osc-bg)] md:static md:w-[min(380px,38vw)] md:shrink-0`}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--osc-border)] px-3">
        <span className={`size-1.5 rounded-full ${queryError ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
        <span className="text-[11px] font-semibold tracking-[0.1em] uppercase">OpenCode Agent</span>
        <select
          value={sessionID}
          onChange={(event) => setSessionID(event.target.value)}
          className="ml-auto min-w-0 max-w-40 rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-2 py-1 text-[11px]"
          aria-label="Agent session"
        >
          {!sessionID && <option value="">New conversation</option>}
          {sessionsQuery.data?.sessions
            .filter((session) => session.metadata?.["opencode-studio"] === studioId)
            .map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={() => createSession.mutate()}
          disabled={createSession.isPending || !csrfToken}
          className="grid size-7 place-items-center rounded-md border border-[var(--osc-border)] text-base hover:bg-[var(--osc-surface)] disabled:opacity-35"
          aria-label="New conversation"
          title="New conversation"
        >
          +
        </button>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-md hover:bg-[var(--osc-surface)]"
          aria-label="Close agent"
        >
          ×
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {sessionsQuery.isLoading && <p className="p-4 text-[12px] text-[var(--osc-text-muted)]">Starting OpenCode…</p>}
        {setupNeeded && (
          <div className="m-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-950">
            Set <code className="font-mono">OPENCODE_STUDIO_PASSWORD</code> and restart the host to enable the agent remotely.
          </div>
        )}
        {authNeeded && (
          <form
            className="m-3 rounded-lg border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3"
            onSubmit={(event) => {
              event.preventDefault()
              savePassword()
            }}
          >
            <label className="text-[11px] font-medium" htmlFor="agent-password">
              Agent password
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="agent-password"
                type="password"
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg)] px-2.5 py-1.5 text-[12px]"
              />
              <button className="rounded-md bg-[var(--osc-primary)] px-3 text-[11px] text-[var(--osc-primary-fg)]" type="submit">
                Unlock
              </button>
            </div>
          </form>
        )}
        {queryError && !authNeeded && !setupNeeded && (
          <p className="m-3 rounded-lg border border-[var(--osc-error)] bg-[var(--osc-error-bg)] p-3 text-[12px] text-[var(--osc-error)]">
            {queryError.message}
          </p>
        )}
        {!queryError && stateQuery.data?.messages.length === 0 && (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <p className="text-[13px] font-medium">Work with the {studioLabel} agent</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--osc-text-muted)]">
                Ask for changes, then inspect the result in the studio beside this panel.
              </p>
            </div>
          </div>
        )}
        {stateQuery.data?.messages.map((message) => {
          const text = messageText(message)
          const tools = message.parts.filter((part) => part.type === "tool")
          return (
            <article
              key={message.info.id}
              className={`border-b border-[var(--osc-border)] px-4 py-3 ${message.info.role === "user" ? "bg-[var(--osc-bg-subtle)]" : ""}`}
            >
              <p className="mb-1.5 text-[9px] font-semibold tracking-[0.12em] text-[var(--osc-text-faint)] uppercase">
                {message.info.role === "user" ? "You" : "Agent"}
              </p>
              {text && <p className="whitespace-pre-wrap text-[12px] leading-[1.65] text-[var(--osc-text)]">{text}</p>}
              {tools.map((part) => (
                <details
                  key={part.id}
                  className="mt-2 rounded-md border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] px-2.5 py-2 text-[10px]"
                >
                  <summary className="cursor-pointer font-mono text-[var(--osc-text-muted)]">
                    {part.tool} · {part.state?.status}
                  </summary>
                  {(part.state?.output || part.state?.error) && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
                      {part.state.output || part.state.error}
                    </pre>
                  )}
                </details>
              ))}
              {message.info.error?.data?.message && (
                <p className="mt-2 text-[11px] text-[var(--osc-error)]">{message.info.error.data.message}</p>
              )}
            </article>
          )
        })}
        {stateQuery.data?.permissions.map((permission) => (
          <div key={permission.id} className="m-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
            <p className="text-[10px] font-semibold tracking-[0.12em] uppercase">Permission requested</p>
            <p className="mt-1 text-[12px] font-medium">{permission.permission}</p>
            <p className="mt-1 break-all font-mono text-[10px]">{permission.patterns.join(", ")}</p>
            <div className="mt-3 flex gap-1.5">
              {(["once", "always", "reject"] as const).map((reply) => (
                <button
                  key={reply}
                  type="button"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ url: `/api/chat/permissions/${permission.id}`, body: { reply } })}
                  className="rounded-md border border-amber-400 px-2 py-1 text-[10px] font-medium hover:bg-amber-100 disabled:opacity-40"
                >
                  {reply}
                </button>
              ))}
            </div>
          </div>
        ))}
        {stateQuery.data?.questions.map((question) => (
          <QuestionCard
            key={question.id}
            request={question}
            disabled={action.isPending}
            onSubmit={(answers) => action.mutate({ url: `/api/chat/questions/${question.id}`, body: { answers } })}
          />
        ))}
        {busy && (
          <p className="px-4 py-3 text-[10px] font-medium tracking-[0.1em] text-[var(--osc-text-faint)] uppercase">Agent is working…</p>
        )}
      </div>

      <form
        className="shrink-0 border-t border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (prompt.trim()) sendPrompt.mutate(prompt.trim())
        }}
      >
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (prompt.trim() && !sendPrompt.isPending) sendPrompt.mutate(prompt.trim())
            }
          }}
          placeholder="Ask the agent…"
          rows={3}
          disabled={authNeeded || setupNeeded}
          className="block w-full resize-none rounded-lg border border-[var(--osc-border)] bg-[var(--osc-bg)] px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-[var(--osc-border-strong)] disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] text-[var(--osc-text-faint)]">Enter to send · Shift+Enter for newline</span>
          {busy ? (
            <button
              type="button"
              onClick={() => action.mutate({ url: `/api/chat/sessions/${sessionID}/abort` })}
              className="rounded-md border border-[var(--osc-border-strong)] px-3 py-1.5 text-[10px] font-medium"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!prompt.trim() || sendPrompt.isPending || !csrfToken || authNeeded || setupNeeded}
              className="rounded-md bg-[var(--osc-primary)] px-3 py-1.5 text-[10px] font-medium text-[var(--osc-primary-fg)] disabled:opacity-35"
            >
              Send
            </button>
          )}
        </div>
        {(sendPrompt.error || createSession.error || action.error) && (
          <p className="mt-2 text-[10px] text-[var(--osc-error)]">{(sendPrompt.error || createSession.error || action.error)?.message}</p>
        )}
      </form>
    </aside>
  )
}
