import { access, mkdir } from "node:fs/promises"
import { isIP } from "node:net"
import path from "node:path"
import { atomicWriteJson } from "../../src/core/paths"
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
const MAX_EVIDENCE_URLS = 16

const writeLocks = new Map<string, Promise<void>>()

async function withDataRootLock<T>(dataRoot: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(dataRoot)
  const previous = writeLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  writeLocks.set(key, chained)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (writeLocks.get(key) === chained) writeLocks.delete(key)
  }
}

async function writeJsonInRoot(dataRoot: string, fileName: string, value: unknown) {
  const target = path.join(dataRoot, fileName)
  if (!isInside(dataRoot, target)) throw new Error("Path escapes Data Root")
  await mkdir(dataRoot, { recursive: true })
  await atomicWriteJson(target, value, { root: dataRoot, mode: 0o644 })
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
  return withDataRootLock(dataRoot, async () => {
    const pool = await loadPool(dataRoot)
    const idx = pool.findIndex((e) => e.name === entry.name)
    if (idx >= 0) pool[idx] = entry
    else pool.push(entry)
    pool.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    await writeJsonInRoot(dataRoot, POOL_FILE, pool)
    return entry
  })
}

export async function rejectCandidate(
  dataRoot: string,
  name: string,
  reason: string,
  batch?: string,
): Promise<{ rejected: RejectEntry; remaining: number }> {
  assertCandidateName(name)
  if (!reason.trim()) throw new Error("reason required")
  return withDataRootLock(dataRoot, async () => {
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
    // Write rejects first so a crash leaves the candidate recoverable from rejects.
    await writeJsonInRoot(dataRoot, REJECTS_FILE, rejects)
    await writeJsonInRoot(dataRoot, POOL_FILE, pool)
    return { rejected, remaining: pool.length }
  })
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

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return true
  const version = isIP(host)
  if (version === 4) {
    const parts = host.split(".").map(Number)
    const [a, b] = parts
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  if (version === 6) {
    if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true
    return false
  }
  return false
}

async function assertPublicHttpUrl(url: string): Promise<URL> {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http(s) allowed")
  }
  if (parsed.username || parsed.password) throw new Error("credentials in URL not allowed")
  if (isBlockedHostname(parsed.hostname)) throw new Error("private or local hosts are not allowed")
  return parsed
}

export async function checkEvidenceUrls(urls: string[], opts: { timeoutMs?: number } = {}): Promise<EvidenceCheck[]> {
  const timeoutMs = opts.timeoutMs ?? 8_000
  const unique = [...new Set(urls.filter((u) => typeof u === "string" && u.trim()))].slice(0, MAX_EVIDENCE_URLS)
  return Promise.all(
    unique.map(async (url): Promise<EvidenceCheck> => {
      try {
        await assertPublicHttpUrl(url)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          let response = await fetch(url, {
            method: "HEAD",
            redirect: "manual",
            signal: controller.signal,
            headers: { "user-agent": "opencode-studio/0.1 evidence-check" },
          })
          // Follow redirects manually, re-validating each target against the blocklist.
          let redirects = 0
          while (response.status >= 300 && response.status < 400 && response.headers.get("location") && redirects < 5) {
            redirects++
            const nextUrl = new URL(response.headers.get("location")!, url).toString()
            await assertPublicHttpUrl(nextUrl)
            response = await fetch(nextUrl, {
              method: "HEAD",
              redirect: "manual",
              signal: controller.signal,
              headers: { "user-agent": "opencode-studio/0.1 evidence-check" },
            })
          }
          if (redirects >= 5) throw new Error("too many redirects")
          if (response.status === 405 || response.status === 501 || response.status === 403) {
            response = await fetch(url, {
              method: "GET",
              redirect: "manual",
              signal: controller.signal,
              headers: { "user-agent": "opencode-studio/0.1 evidence-check" },
            })
            let getRedirects = 0
            while (response.status >= 300 && response.status < 400 && response.headers.get("location") && getRedirects < 5) {
              getRedirects++
              const nextUrl = new URL(response.headers.get("location")!, url).toString()
              await assertPublicHttpUrl(nextUrl)
              response = await fetch(nextUrl, {
                method: "GET",
                redirect: "manual",
                signal: controller.signal,
                headers: { "user-agent": "opencode-studio/0.1 evidence-check" },
              })
            }
            if (getRedirects >= 5) throw new Error("too many redirects")
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
