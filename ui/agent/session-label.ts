import type { Session } from "@opencode-ai/sdk/v2/client"

const GENERATED_SESSION_TITLE = /^New session - (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/

export function sessionLabel(session?: Pick<Session, "id" | "title">, now = Date.now()): string {
  if (!session) return "New session"
  const title = session.title || session.id.slice(0, 12)
  const match = GENERATED_SESSION_TITLE.exec(title)
  if (!match) return title

  const created = new Date(match[1])
  if (Number.isNaN(created.getTime())) return title

  const today = new Date(now)
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(created)
  const isToday =
    created.getFullYear() === today.getFullYear() && created.getMonth() === today.getMonth() && created.getDate() === today.getDate()
  if (isToday) return `New session · ${time}`

  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: created.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(created)
  return `New session · ${date}, ${time}`
}

export function sessionOptionLabels(sessions: Array<Pick<Session, "id" | "title">>, now = Date.now()): Map<string, string> {
  const labels = sessions.map((session) => sessionLabel(session, now))
  const totals = new Map<string, number>()
  sessions.forEach((session, index) => {
    if (!GENERATED_SESSION_TITLE.test(session.title || "")) return
    const label = labels[index]
    totals.set(label, (totals.get(label) ?? 0) + 1)
  })

  const seen = new Map<string, number>()
  return new Map(
    sessions.map((session, index) => {
      const label = labels[index]
      if (!GENERATED_SESSION_TITLE.test(session.title || "")) return [session.id, label]
      const total = totals.get(label) ?? 1
      if (total === 1) return [session.id, label]
      const position = (seen.get(label) ?? 0) + 1
      seen.set(label, position)
      return [session.id, `${label} (${position}/${total})`]
    }),
  )
}
