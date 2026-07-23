import { randomUUID } from "node:crypto"
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  assertCandidateName,
  type CandidateSummary,
  normalizePoolEntry,
  normalizeRejectEntry,
  type PoolEntry,
  type RejectEntry,
  toSummary,
} from "./schemas"
import { isInside, readRegularFileInside } from "./studio-path"

const POOL_FILE = "pool.json"
const REJECTS_FILE = "rejects.json"

async function atomicWriteJson(dataRoot: string, fileName: string, value: unknown) {
  const target = path.join(dataRoot, fileName)
  if (!isInside(dataRoot, target)) throw new Error("Path escapes Data Root")
  await mkdir(dataRoot, { recursive: true })
  const temporary = path.join(dataRoot, `.${fileName}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o644 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function readJsonArray(dataRoot: string, fileName: string): Promise<unknown[]> {
  try {
    await access(path.join(dataRoot, fileName))
  } catch {
    return []
  }
  const raw = JSON.parse(await readRegularFileInside(dataRoot, fileName, "utf8")) as unknown
  if (!Array.isArray(raw)) throw new Error(`${fileName} must be a JSON array`)
  return raw
}

export async function loadPool(dataRoot: string): Promise<PoolEntry[]> {
  const raw = await readJsonArray(dataRoot, POOL_FILE)
  return raw.map((item, i) => {
    try {
      return normalizePoolEntry(item)
    } catch (error) {
      throw new Error(`pool.json[${i}]: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

export async function loadRejects(dataRoot: string): Promise<RejectEntry[]> {
  const raw = await readJsonArray(dataRoot, REJECTS_FILE)
  return raw.map((item, i) => {
    try {
      return normalizeRejectEntry(item)
    } catch (error) {
      throw new Error(`rejects.json[${i}]: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

export async function listCandidates(
  dataRoot: string,
  opts: { minTotal?: number; signalClass?: "A" | "B"; verdict?: PoolEntry["verdict"] } = {},
): Promise<CandidateSummary[]> {
  let pool = await loadPool(dataRoot)
  if (opts.minTotal !== undefined) pool = pool.filter((e) => e.total >= opts.minTotal!)
  if (opts.signalClass) pool = pool.filter((e) => e.signal_class === opts.signalClass)
  if (opts.verdict) pool = pool.filter((e) => e.verdict === opts.verdict)
  return pool.map(toSummary).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

export async function readCandidate(dataRoot: string, name: string): Promise<PoolEntry> {
  assertCandidateName(name)
  const pool = await loadPool(dataRoot)
  const entry = pool.find((e) => e.name === name)
  if (!entry) throw new Error(`Candidate not found: ${name}`)
  return entry
}

export async function upsertCandidate(dataRoot: string, raw: unknown): Promise<PoolEntry> {
  const entry = normalizePoolEntry(raw)
  const pool = await loadPool(dataRoot)
  const idx = pool.findIndex((e) => e.name === entry.name)
  if (idx >= 0) pool[idx] = entry
  else pool.push(entry)
  pool.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  await atomicWriteJson(dataRoot, POOL_FILE, pool)
  return entry
}

export async function rejectCandidate(
  dataRoot: string,
  name: string,
  reason: string,
  batch?: string,
): Promise<{ rejected: RejectEntry; remaining: number }> {
  assertCandidateName(name)
  if (!reason.trim()) throw new Error("reason required")
  const pool = await loadPool(dataRoot)
  const idx = pool.findIndex((e) => e.name === name)
  if (idx < 0) throw new Error(`Candidate not found in pool: ${name}`)
  const [removed] = pool.splice(idx, 1)
  const rejects = await loadRejects(dataRoot)
  const existing = rejects.findIndex((r) => r.name === name)
  const rejected: RejectEntry = {
    name: removed.name,
    problem: removed.problem,
    buyer: removed.buyer,
    reason: reason.trim(),
    batch: batch?.trim() || removed.batch || "manual",
    first_seen: removed.first_seen,
  }
  if (existing >= 0) rejects[existing] = rejected
  else rejects.push(rejected)
  rejects.sort((a, b) => a.name.localeCompare(b.name))
  await atomicWriteJson(dataRoot, POOL_FILE, pool)
  await atomicWriteJson(dataRoot, REJECTS_FILE, rejects)
  return { rejected, remaining: pool.length }
}

export async function poolStatus(dataRoot: string) {
  const [pool, rejects] = await Promise.all([loadPool(dataRoot), loadRejects(dataRoot)])
  const byVerdict = { verified: 0, partial: 0, unverified: 0 }
  const byClass = { A: 0, B: 0 }
  let sum = 0
  for (const e of pool) {
    byVerdict[e.verdict]++
    byClass[e.signal_class]++
    sum += e.total
  }
  const top = [...pool]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(toSummary)
  return {
    pool: pool.length,
    rejects: rejects.length,
    byVerdict,
    byClass,
    avgTotal: pool.length ? Math.round((sum / pool.length) * 10) / 10 : 0,
    top,
  }
}

export type EvidenceCheck = {
  url: string
  ok: boolean
  status?: number
  error?: string
}

export async function checkEvidenceUrls(urls: string[], opts: { timeoutMs?: number } = {}): Promise<EvidenceCheck[]> {
  const timeoutMs = opts.timeoutMs ?? 8_000
  const unique = [...new Set(urls.filter((u) => typeof u === "string" && u.trim()))]
  return Promise.all(
    unique.map(async (url): Promise<EvidenceCheck> => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { url, ok: false, error: "only http(s) allowed" }
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          let response = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
            signal: controller.signal,
            headers: { "user-agent": "opencode-studio/0.1 evidence-check" },
          })
          if (response.status === 405 || response.status === 501 || response.status === 403) {
            response = await fetch(url, {
              method: "GET",
              redirect: "follow",
              signal: controller.signal,
              headers: { "user-agent": "opencode-studio/0.1 evidence-check" },
            })
          }
          const ok = response.ok || response.status === 429
          return { url, ok, status: response.status, ...(ok ? {} : { error: `HTTP ${response.status}` }) }
        } finally {
          clearTimeout(timer)
        }
      } catch (error) {
        return {
          url,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
        }
      }
    }),
  )
}
