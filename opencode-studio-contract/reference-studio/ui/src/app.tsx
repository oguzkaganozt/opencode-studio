import { useQuery } from "@tanstack/react-query"
import { Link, Route, Routes, useParams } from "react-router"

type NoteSummary = { id: string; title: string }
type Note = NoteSummary & { body: string }
type StudioInfo = { id: string; packageVersion: string; contractVersion: string }

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json() as Promise<T>
}

function StudioBar({ studio }: { studio?: StudioInfo }) {
  return (
    <header className="flex h-10 items-center justify-between border-b border-[var(--osc-border)] px-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-semibold tracking-wide" data-studio="reference">
          Reference Studio
        </span>
        <span className="mono text-xs text-[var(--osc-text-muted)]">
          {studio ? `${studio.id}@${studio.packageVersion}` : "loading"}
        </span>
      </div>
      <span className="mono text-xs text-[var(--osc-text-faint)]">OSC {studio?.contractVersion ?? "…"}</span>
    </header>
  )
}

function ResourceRail({ notes, selectedId }: { notes: NoteSummary[]; selectedId?: string }) {
  return (
    <aside className="w-56 shrink-0 overflow-auto border-r border-[var(--osc-border)] bg-[var(--osc-bg-elevated)]">
      <div className="border-b border-[var(--osc-border)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">
        Notes
      </div>
      <nav className="flex flex-col p-1">
        {notes.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[var(--osc-text-muted)]">No notes in Data Root.</p>
        ) : (
          notes.map((note) => {
            const active = note.id === selectedId
            return (
              <Link
                key={note.id}
                to={`/notes/${note.id}`}
                className={`rounded-[var(--osc-radius-md)] px-2 py-1.5 text-sm ${
                  active
                    ? "bg-[var(--osc-surface)] text-[var(--osc-text)]"
                    : "text-[var(--osc-text-muted)] hover:bg-[var(--osc-surface-hover)] hover:text-[var(--osc-text)]"
                }`}
              >
                <div>{note.title}</div>
                <div className="mono text-[11px] text-[var(--osc-text-faint)]">{note.id}</div>
              </Link>
            )
          })
        )}
      </nav>
    </aside>
  )
}

function NoteViewport({ id }: { id?: string }) {
  const query = useQuery({
    queryKey: ["note", id],
    enabled: Boolean(id),
    queryFn: () => fetchJson<Note>(`/api/notes/${id}`),
  })

  if (!id) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[var(--osc-canvas-bg)] text-[var(--osc-text-muted)]">
        Select a note to inspect.
      </main>
    )
  }

  if (query.isLoading) {
    return <main className="flex flex-1 items-center justify-center text-[var(--osc-text-muted)]">Loading…</main>
  }

  if (query.isError || !query.data) {
    return (
      <main className="flex flex-1 items-center justify-center text-[var(--osc-error)]" role="alert">
        Note not found.
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col overflow-auto bg-[var(--osc-canvas-bg)] p-6">
      <h1 className="mb-1 text-2xl font-semibold">{query.data.title}</h1>
      <p className="mono mb-4 text-xs text-[var(--osc-text-muted)]">id: {query.data.id}</p>
      <pre className="mono whitespace-pre-wrap rounded-[var(--osc-radius-md)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-4 text-sm leading-relaxed">
        {query.data.body}
      </pre>
    </main>
  )
}

function Inspector({ note }: { note?: Note }) {
  return (
    <aside className="hidden w-64 shrink-0 overflow-auto border-l border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] md:block">
      <div className="border-b border-[var(--osc-border)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--osc-text-muted)]">
        Inspector
      </div>
      <dl className="space-y-3 p-3 text-sm">
        <div>
          <dt className="text-[var(--osc-text-muted)]">Kind</dt>
          <dd className="mono">note</dd>
        </div>
        <div>
          <dt className="text-[var(--osc-text-muted)]">Id</dt>
          <dd className="mono">{note?.id ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--osc-text-muted)]">Title</dt>
          <dd>{note?.title ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--osc-text-muted)]">Body length</dt>
          <dd className="mono">{note ? String(note.body.length) : "—"}</dd>
        </div>
      </dl>
    </aside>
  )
}

function StatusStrip({ count }: { count: number }) {
  return (
    <footer className="flex h-7 items-center border-t border-[var(--osc-border)] px-3 text-xs text-[var(--osc-text-muted)]">
      <span className="mono">{count} notes</span>
      <span className="mx-2 text-[var(--osc-text-faint)]">|</span>
      <span>Read-only Companion</span>
    </footer>
  )
}

function Shell() {
  const params = useParams()
  const selectedId = params.id
  const studioQuery = useQuery({
    queryKey: ["studio"],
    queryFn: () => fetchJson<StudioInfo>("/api/studio"),
  })
  const notesQuery = useQuery({
    queryKey: ["notes"],
    queryFn: async () => (await fetchJson<{ notes: NoteSummary[] }>("/api/notes")).notes,
  })
  const noteQuery = useQuery({
    queryKey: ["note", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => fetchJson<Note>(`/api/notes/${selectedId}`),
  })

  const notes = notesQuery.data ?? []

  return (
    <div className="flex h-full flex-col" data-studio="reference" style={{ ["--osc-accent" as string]: "var(--osc-accent-cad)" }}>
      <StudioBar studio={studioQuery.data} />
      <div className="flex min-h-0 flex-1">
        <ResourceRail notes={notes} selectedId={selectedId} />
        <NoteViewport id={selectedId} />
        <Inspector note={noteQuery.data} />
      </div>
      <StatusStrip count={notes.length} />
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Shell />} />
      <Route path="/notes/:id" element={<Shell />} />
      <Route
        path="*"
        element={
          <div className="flex h-full items-center justify-center text-[var(--osc-error)]" role="alert">
            Route not found.
          </div>
        }
      />
    </Routes>
  )
}
