export type UpdateInfo = {
  packageName: string
  current: string
  latest: string | null
  updateAvailable: boolean
  checkedAt: number
  /** Human hint when updateAvailable */
  message?: string
  error?: string
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

type CacheEntry = UpdateInfo & { expiresAt: number }

const cache = new Map<string, CacheEntry>()

/** Compare dotted versions; returns true if `latest` is strictly greater than `current`. */
export function isVersionNewer(latest: string, current: string): boolean {
  const a = latest
    .replace(/^v/, "")
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0)
  const b = current
    .replace(/^v/, "")
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0)
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const lv = a[i] ?? 0
    const cv = b[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

export async function checkNpmUpdate(input: {
  packageName: string
  current: string
  ttlMs?: number
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
}): Promise<UpdateInfo> {
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
  const key = input.packageName
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now && hit.current === input.current) {
    return hit
  }

  const base: UpdateInfo = {
    packageName: input.packageName,
    current: input.current,
    latest: null,
    updateAvailable: false,
    checkedAt: now,
  }

  try {
    const fetchFn = input.fetchImpl ?? fetch
    const url = `https://registry.npmjs.org/${input.packageName.replace("/", "%2F")}/latest`
    const response = await fetchFn(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      const info = { ...base, error: `npm registry HTTP ${response.status}` }
      cache.set(key, { ...info, expiresAt: now + Math.min(ttlMs, 30 * 60 * 1000) })
      return info
    }
    const body = (await response.json()) as { version?: string }
    const latest = typeof body.version === "string" ? body.version : null
    const updateAvailable = Boolean(latest && isVersionNewer(latest, input.current))
    const info: UpdateInfo = {
      ...base,
      latest,
      updateAvailable,
      message: updateAvailable ? `Update available: ${input.current} → ${latest}. Run: opencode-studio upgrade` : undefined,
    }
    cache.set(key, { ...info, expiresAt: now + ttlMs })
    return info
  } catch (error) {
    const info = {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    }
    cache.set(key, { ...info, expiresAt: now + Math.min(ttlMs, 30 * 60 * 1000) })
    return info
  }
}

/** Fire-and-forget check; logs when a new latest version is first observed. */
let lastLoggedLatest: string | null = null
export function scheduleUpdateLog(input: { packageName: string; current: string }) {
  void checkNpmUpdate(input).then((info) => {
    if (info.updateAvailable && info.latest && info.message && info.latest !== lastLoggedLatest) {
      lastLoggedLatest = info.latest
      console.log(`[opencode-studio] ${info.message}`)
    }
  })
}
