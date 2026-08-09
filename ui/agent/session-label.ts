import type { Session } from "@opencode-ai/sdk/v2/client"

const GENERATED_SESSION_TITLE = /^New session - (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/

export type SessionDayGroup<T> = {
  key: string
  label: string
  sessions: T[]
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function sessionDayLabel(timestamp: number, now: number): string {
  const date = new Date(timestamp)
  const today = new Date(now)
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dayDifference = Math.round((todayStart - dateStart) / 86_400_000)

  if (dayDifference === 0 || dayDifference === 1) {
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-dayDifference, "day")
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date)
}

export function sessionGroupsByLastMessage<T extends Pick<Session, "time">>(sessions: T[], now = Date.now()): SessionDayGroup<T>[] {
  const groups = new Map<string, SessionDayGroup<T>>()
  const ordered = [...sessions].sort((a, b) => b.time.updated - a.time.updated)

  for (const session of ordered) {
    const date = new Date(session.time.updated)
    const key = localDayKey(date)
    const group = groups.get(key)
    if (group) {
      group.sessions.push(session)
    } else {
      groups.set(key, { key, label: sessionDayLabel(session.time.updated, now), sessions: [session] })
    }
  }

  return [...groups.values()]
}

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
