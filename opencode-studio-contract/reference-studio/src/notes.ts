import { randomUUID } from "node:crypto"
import { readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { readRegularFileInside } from "./studio-path"

export type Note = {
  id: string
  title: string
  body: string
}

const NOTE_PATTERN = /^[a-z0-9][a-z0-9_-]*\.note\.json$/

export function noteFileName(id: string) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid note id: ${id}`)
  return `${id}.note.json`
}

export async function listNotes(dataRoot: string): Promise<Note[]> {
  const entries = await readdir(dataRoot, { withFileTypes: true })
  const notes: Note[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !NOTE_PATTERN.test(entry.name)) continue
    const note = await readNoteFile(dataRoot, entry.name).catch(() => null)
    if (note) notes.push(note)
  }
  return notes.sort((a, b) => a.id.localeCompare(b.id))
}

export async function readNote(dataRoot: string, id: string): Promise<Note> {
  return readNoteFile(dataRoot, noteFileName(id))
}

async function readNoteFile(dataRoot: string, fileName: string): Promise<Note> {
  const raw = JSON.parse(await readRegularFileInside(dataRoot, fileName, "utf8")) as Partial<Note>
  if (typeof raw.id !== "string" || typeof raw.title !== "string" || typeof raw.body !== "string") {
    throw new Error(`Invalid note file: ${fileName}`)
  }
  return { id: raw.id, title: raw.title, body: raw.body }
}

export async function writeNote(dataRoot: string, note: Note) {
  const fileName = noteFileName(note.id)
  const target = path.join(dataRoot, fileName)
  const temporary = path.join(dataRoot, `.${fileName}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(note, null, 2)}\n`, { flag: "wx", mode: 0o644 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
  return note
}
