import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export const CAD_PART_AGENT = "cad-part"
export const CAD_PART_DISPATCH_CAP = 3
const DISPATCH_FILE = ".cad-dispatch.json"

export type CadDispatchMode = "serial" | "parallel"

export type CadDispatchPlan = {
  mode: CadDispatchMode
  assigned: string[]
  remaining: string[]
}

export type CadPartSpawn = {
  directory: string
  parentSessionID: string
  designId: string
  partId: string
  source: string
  brief?: string
  params?: string
}

export type CadPartWorker = {
  partId: string
  source: string
  sessionID?: string
  error?: string
}

export type CadPartDispatcher = {
  spawn: (input: CadPartSpawn) => Promise<{ sessionID: string }>
}

export type CadDispatchResult = {
  mode: CadDispatchMode
  assigned: string[]
  remaining: string[]
  workers: CadPartWorker[]
  reason?: string
}

export function planCadDispatch(partIds: string[]): CadDispatchPlan {
  if (partIds.length < 2) return { mode: "serial", assigned: [], remaining: partIds }
  return {
    mode: "parallel",
    assigned: partIds.slice(0, CAD_PART_DISPATCH_CAP),
    remaining: partIds.slice(CAD_PART_DISPATCH_CAP),
  }
}

export function partSourceIsStub(text: string): boolean {
  return /raise\s+NotImplementedError\s*\(\s*["']Model /.test(text)
}

export async function readPartSourceStatus(designDir: string, source: string) {
  const file = path.join(designDir, source)
  try {
    const text = await readFile(file, "utf8")
    return { source, ready: !partSourceIsStub(text), stub: partSourceIsStub(text) }
  } catch {
    return { source, ready: false, stub: true }
  }
}

export function cadPartWorkerPrompt(input: CadPartSpawn) {
  const brief = input.brief?.trim()
  const params = input.params?.trim()
  return [
    `You are a CAD part worker for design \`${input.designId}\`.`,
    `Model only part \`${input.partId}\`. Write the implementation to \`${input.source}\`.`,
    brief ? `Product brief: ${brief}` : "",
    params ? `Shared params.py:\n${params}` : "Import shared values from params.py.",
    "Load skill `studio-cad-part`.",
    "In-session: cad_execute → cad_validate → cad_measure → cad_analyze_printability (bed pose), then save the source.",
    "Do not call cad_design_build, cad_design_create, cad_design_dispatch, cad_design_join, cad_design_qc_report, cad_spec, or cad_compare.",
    "Do not model any other part.",
  ]
    .filter(Boolean)
    .join(" ")
}

type DispatchState = { workers: CadPartWorker[] }

async function readDispatchState(designDir: string): Promise<DispatchState> {
  try {
    const raw = JSON.parse(await readFile(path.join(designDir, DISPATCH_FILE), "utf8")) as DispatchState
    return { workers: Array.isArray(raw.workers) ? raw.workers : [] }
  } catch {
    return { workers: [] }
  }
}

async function writeDispatchState(designDir: string, state: DispatchState) {
  await writeFile(path.join(designDir, DISPATCH_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf8")
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
}): Promise<CadDispatchResult> {
  const plan = planCadDispatch(input.parts.map((part) => part.id))
  if (plan.mode === "serial") {
    return { mode: "serial", assigned: [], remaining: plan.remaining, workers: [] }
  }
  if (!input.dispatcher) {
    return { mode: "serial", assigned: [], remaining: plan.remaining, workers: [], reason: "dispatcher unavailable" }
  }
  const prior = await readDispatchState(input.designDir)
  const already = new Set(prior.workers.filter((worker) => worker.sessionID).map((worker) => worker.partId))
  const workers = [...prior.workers]
  for (const partId of plan.assigned) {
    if (already.has(partId)) continue
    const part = input.parts.find((item) => item.id === partId)
    if (!part) continue
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
      workers.push({ partId, source: part.source, sessionID: spawned.sessionID })
    } catch (error) {
      workers.push({ partId, source: part.source, error: error instanceof Error ? error.message : String(error) })
    }
  }
  await writeDispatchState(input.designDir, { workers })
  return { mode: "parallel", assigned: plan.assigned, remaining: plan.remaining, workers }
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
    }) => Promise<{ data?: { id: string } | null; error?: unknown }>
    messages: (input: {
      path: { id: string }
      query?: { directory?: string; limit?: number }
    }) => Promise<{ data?: Array<{ info?: { role?: string; providerID?: string; modelID?: string } }> | null; error?: unknown }>
    promptAsync: (input: {
      path: { id: string }
      query?: { directory?: string }
      body?: {
        agent?: string
        model?: CadSessionModel
        parts: Array<{ type: "text"; text: string }>
      }
    }) => Promise<{ error?: unknown }>
  }
}

export function createClientDispatcher(client: SessionClient | undefined): CadPartDispatcher | undefined {
  if (!client?.session?.create || !client?.session?.promptAsync) return undefined
  return {
    async spawn(input) {
      const created = await client.session.create({
        query: { directory: input.directory },
        body: {
          parentID: input.parentSessionID,
          title: `${CAD_PART_AGENT} ${input.designId}/${input.partId}`,
        },
      })
      const sessionID = created.data?.id
      if (!sessionID) throw new Error("failed to create cad-part session")
      const listed = await client.session.messages({
        path: { id: input.parentSessionID },
        query: { directory: input.directory },
      })
      const model = parentModelFromMessages(listed.data ?? [])
      const prompted = await client.session.promptAsync({
        path: { id: sessionID },
        query: { directory: input.directory },
        body: {
          agent: CAD_PART_AGENT,
          model,
          parts: [{ type: "text", text: cadPartWorkerPrompt(input) }],
        },
      })
      if (prompted.error) throw new Error("failed to prompt cad-part session")
      return { sessionID }
    },
  }
}
