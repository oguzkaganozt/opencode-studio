import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export const CAD_PART_AGENT = "cad-part"
export const CAD_PART_DISPATCH_CAP = 3
const DISPATCH_FILE = ".cad-dispatch.json"
const LEASE_MS = 60_000

export type CadWorkerState = "starting" | "running" | "ready" | "failed" | "cancelled" | "superseded"

export type CadWorkerRecord = {
  partId: string
  sessionId: string
  generation: number
  leaseId: string
  state: CadWorkerState
  leaseExpiresAt: number
  heartbeatAt: number
  startedAt: number
  finishedAt?: number
  error?: string
}

export type CadDispatchLedger = { workers: CadWorkerRecord[] }

export type CadPartSpawn = {
  directory: string
  parentSessionID: string
  designId: string
  partId: string
  source: string
  brief?: string
  params?: string
}

export type CadPartDispatcher = {
  spawn: (input: CadPartSpawn) => Promise<{ sessionID: string }>
}

export function planCadDispatch(partIds: string[]) {
  if (partIds.length < 2) return { mode: "serial" as const, assigned: [] as string[], remaining: partIds }
  return { mode: "parallel" as const, assigned: partIds.slice(0, CAD_PART_DISPATCH_CAP), remaining: partIds.slice(CAD_PART_DISPATCH_CAP) }
}

export async function readDispatchLedger(designDir: string): Promise<CadDispatchLedger> {
  try {
    const raw = JSON.parse(await readFile(path.join(designDir, DISPATCH_FILE), "utf8")) as CadDispatchLedger
    return { workers: Array.isArray(raw.workers) ? raw.workers : [] }
  } catch {
    return { workers: [] }
  }
}

export async function writeDispatchLedger(designDir: string, ledger: CadDispatchLedger) {
  await writeFile(path.join(designDir, DISPATCH_FILE), `${JSON.stringify(ledger, null, 2)}\n`, "utf8")
}

export function activeWorker(ledger: CadDispatchLedger, partId: string, now = Date.now()): CadWorkerRecord | undefined {
  const record = ledger.workers.find((item) => item.partId === partId && (item.state === "starting" || item.state === "running"))
  if (!record) return undefined
  if (record.leaseExpiresAt < now) return undefined
  return record
}

export function assertWorkerWrite(input: {
  ledger: CadDispatchLedger
  partId: string
  sessionId?: string
  now?: number
}): CadWorkerRecord | undefined {
  const record = activeWorker(input.ledger, input.partId, input.now)
  if (!record) return undefined
  if (!input.sessionId || input.sessionId !== record.sessionId) {
    throw new Error(`part ${input.partId} is leased by another session`)
  }
  return record
}

export function isWorkerSession(ledger: CadDispatchLedger, sessionId?: string) {
  return Boolean(
    sessionId && ledger.workers.some((item) => item.sessionId === sessionId && (item.state === "starting" || item.state === "running")),
  )
}

export function renewLease(record: CadWorkerRecord, now = Date.now()): CadWorkerRecord {
  return { ...record, heartbeatAt: now, leaseExpiresAt: now + LEASE_MS, state: record.state === "starting" ? "running" : record.state }
}

export function markWorkerReady(ledger: CadDispatchLedger, partId: string, now = Date.now()): CadDispatchLedger {
  return {
    workers: ledger.workers.map((item) => (item.partId === partId ? { ...item, state: "ready" as const, finishedAt: now } : item)),
  }
}

export function takeoverPart(ledger: CadDispatchLedger, partId: string, sessionId: string, now = Date.now()): CadDispatchLedger {
  const prior = ledger.workers.find((item) => item.partId === partId)
  const generation = (prior?.generation ?? 0) + 1
  const next: CadWorkerRecord = {
    partId,
    sessionId,
    generation,
    leaseId: randomUUID(),
    state: "starting",
    leaseExpiresAt: now + LEASE_MS,
    heartbeatAt: now,
    startedAt: now,
  }
  const others = ledger.workers
    .filter((item) => item.partId !== partId)
    .concat(prior ? [{ ...prior, state: "superseded" as const, finishedAt: now }] : [])
  return { workers: [...others.filter((item) => item.partId !== partId || item.state === "superseded"), next] }
}

export function cadPartWorkerPrompt(input: CadPartSpawn) {
  const brief = input.brief?.trim()
  const params = input.params?.trim()
  return [
    `You are a CAD part worker for design \`${input.designId}\`.`,
    `Model only part \`${input.partId}\` with cad_ir_apply. IR path is ir/${input.partId.replace(/-/g, "_")}.json.`,
    brief ? `Product brief: ${brief}` : "",
    params ? `Shared params.py:\n${params}` : "Use params.py names in the IR params list.",
    "Load skill `studio-cad-part`.",
    "Write IR only. Do not call cad_design_build, cad_design_create, cad_design_join, cad_design_qc_report, cad_compare, or cad_print_plan_apply.",
    "Do not model any other part. cad_source_apply is denied unless this part is already hand.",
  ]
    .filter(Boolean)
    .join(" ")
}

export type CadSessionModel = { providerID: string; modelID: string }

export function parentModelFromMessages(
  messages: Array<{ info?: { role?: string; providerID?: string; modelID?: string } }>,
): CadSessionModel | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i]?.info
    if (info?.role === "assistant" && info.providerID && info.modelID) return { providerID: info.providerID, modelID: info.modelID }
  }
}

type SessionClient = {
  session: {
    create: (input: {
      query?: { directory?: string }
      body?: { parentID?: string; title?: string }
    }) => Promise<{ data?: { id: string } | null }>
    messages: (input: {
      path: { id: string }
      query?: { directory?: string; limit?: number }
    }) => Promise<{ data?: Array<{ info?: { role?: string; providerID?: string; modelID?: string } }> | null }>
    promptAsync: (input: {
      path: { id: string }
      query?: { directory?: string }
      body?: { agent?: string; model?: CadSessionModel; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<{ error?: unknown }>
  }
}

export function createClientDispatcher(client: SessionClient | undefined): CadPartDispatcher | undefined {
  if (!client?.session?.create || !client?.session?.promptAsync) return undefined
  return {
    async spawn(input) {
      const created = await client.session.create({
        query: { directory: input.directory },
        body: { parentID: input.parentSessionID, title: `${CAD_PART_AGENT} ${input.designId}/${input.partId}` },
      })
      const sessionID = created.data?.id
      if (!sessionID) throw new Error("failed to create cad-part session")
      const listed = await client.session.messages({ path: { id: input.parentSessionID }, query: { directory: input.directory } })
      const prompted = await client.session.promptAsync({
        path: { id: sessionID },
        query: { directory: input.directory },
        body: {
          agent: CAD_PART_AGENT,
          model: parentModelFromMessages(listed.data ?? []),
          parts: [{ type: "text", text: cadPartWorkerPrompt(input) }],
        },
      })
      if (prompted.error) throw new Error("failed to prompt cad-part session")
      return { sessionID }
    },
  }
}

export async function spawnCadParts(input: {
  designId: string
  designDir: string
  parts: Array<{ id: string; source: string }>
  dispatcher?: CadPartDispatcher
  directory: string
  parentSessionID: string
  brief?: string
  params?: string
}) {
  const plan = planCadDispatch(input.parts.map((part) => part.id))
  if (plan.mode === "serial" || !input.dispatcher) {
    return {
      mode: "serial" as const,
      assigned: [] as string[],
      remaining: plan.remaining,
      workers: [] as CadWorkerRecord[],
      reason: input.dispatcher ? undefined : "dispatcher unavailable",
    }
  }
  const ledger = await readDispatchLedger(input.designDir)
  const now = Date.now()
  for (const partId of plan.assigned) {
    if (
      ledger.workers.some(
        (item) => item.partId === partId && (item.state === "starting" || item.state === "running") && item.leaseExpiresAt >= now,
      )
    ) {
      continue
    }
    const part = input.parts.find((item) => item.id === partId)
    if (!part) continue
    const next = takeoverPart(ledger, partId, "pending", now)
    const pending = next.workers.find((item) => item.partId === partId && item.state === "starting")
    if (!pending) continue
    ledger.workers = next.workers
    await writeDispatchLedger(input.designDir, ledger)
    try {
      const spawned = await input.dispatcher.spawn({
        directory: input.directory,
        parentSessionID: input.parentSessionID,
        designId: input.designId,
        partId,
        source: part.source,
        brief: input.brief,
        params: input.params,
      })
      pending.sessionId = spawned.sessionID
      pending.state = "running"
      pending.heartbeatAt = Date.now()
      pending.leaseExpiresAt = Date.now() + LEASE_MS
      await writeDispatchLedger(input.designDir, ledger)
    } catch (error) {
      pending.state = "failed"
      pending.error = error instanceof Error ? error.message : String(error)
      pending.finishedAt = Date.now()
      await writeDispatchLedger(input.designDir, ledger)
    }
  }
  return { mode: "parallel" as const, assigned: plan.assigned, remaining: plan.remaining, workers: ledger.workers }
}
