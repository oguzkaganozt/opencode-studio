import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"
import { isInside } from "../../src/core/paths"
import { safeExternalHref } from "../../src/core/security"

export type CatalogPart = {
  mpn: string
  manufacturer?: string
  description?: string
  datasheet?: string
  category?: string
  [key: string]: unknown
}

export type CatalogReason = "catalog_directory_missing" | "catalog_unreadable" | "catalog_empty" | "no_matches" | "part_not_found"

export type CatalogState = {
  available: boolean
  scope: "workspace"
  catalogPath: string
  reason: Exclude<CatalogReason, "no_matches" | "part_not_found"> | null
  parts: CatalogPart[]
  malformedCount: number
  skippedCount: number
}

const CATALOG_SUBDIR = path.join("catalog", "parts")
const MAX_PART_FILE_BYTES = 256 * 1024
const MAX_CATALOG_PARTS = 2000
const MAX_MPN_FILE_CHARS = 180
/** Legacy plain filenames (no encoding). */
const PLAIN_MPN_FILE_RE = /^[A-Za-z0-9._+-]+$/

function catalogPartsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, CATALOG_SUBDIR)
}

function mpnFromFilename(filename: string): string {
  const stem = path.basename(filename, path.extname(filename))
  try {
    return decodeURIComponent(stem)
  } catch {
    return stem
  }
}

/** Basenames only — reject path traversal; plain or percent-encoded stems are fine. */
function isSafeCatalogStem(stem: string): boolean {
  return Boolean(stem) && !stem.includes("..") && !stem.includes("/") && !stem.includes("\\") && !stem.includes("\0")
}

const KNOWN_PART_KEYS = new Set(["mpn", "manufacturer", "description", "datasheet", "category"])

function isScalarExtra(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function parsePart(raw: unknown, mpnFallback: string): CatalogPart {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { mpn: mpnFallback }
  }
  const record = raw as Record<string, unknown>
  const mpn = typeof record.mpn === "string" && record.mpn.trim() ? record.mpn.trim() : mpnFallback
  const datasheetRaw = typeof record.datasheet === "string" ? record.datasheet : undefined
  const datasheet = datasheetRaw ? (safeExternalHref(datasheetRaw) ?? undefined) : undefined
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (KNOWN_PART_KEYS.has(key)) continue
    if (isScalarExtra(value)) extras[key] = value
    else if (Array.isArray(value) && value.every((item) => isScalarExtra(item) || item === null)) extras[key] = value
  }
  return {
    mpn,
    ...(typeof record.manufacturer === "string" ? { manufacturer: record.manufacturer } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    ...(typeof record.category === "string" ? { category: record.category } : {}),
    ...(datasheet ? { datasheet } : {}),
    ...extras,
  }
}

export async function inspectCatalog(workspaceRoot: string): Promise<CatalogState> {
  const dir = catalogPartsDir(workspaceRoot)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "catalog_directory_missing" : "catalog_unreadable"
    return {
      available: false,
      scope: "workspace",
      catalogPath: CATALOG_SUBDIR,
      reason,
      parts: [],
      malformedCount: 0,
      skippedCount: 0,
    }
  }

  const yamlFiles = entries.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).sort()
  const parts: CatalogPart[] = []
  let malformedCount = 0
  let skippedCount = entries.length - yamlFiles.length

  for (let i = 0; i < yamlFiles.length; i++) {
    if (parts.length >= MAX_CATALOG_PARTS) {
      skippedCount += yamlFiles.length - i
      break
    }
    const file = yamlFiles[i]!
    const stem = path.basename(file, path.extname(file))
    if (!isSafeCatalogStem(stem)) {
      skippedCount++
      continue
    }
    const mpnFallback = mpnFromFilename(file)
    const filePath = path.join(dir, file)
    if (!isInside(workspaceRoot, filePath)) {
      skippedCount++
      continue
    }
    try {
      const info = await lstat(filePath)
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_PART_FILE_BYTES) {
        skippedCount++
        continue
      }
      const content = await readFile(filePath, "utf8")
      const raw = yaml.load(content)
      parts.push(parsePart(raw, mpnFallback))
    } catch {
      malformedCount++
    }
  }

  return {
    available: true,
    scope: "workspace",
    catalogPath: CATALOG_SUBDIR,
    reason: yamlFiles.length === 0 ? "catalog_empty" : null,
    parts,
    malformedCount,
    skippedCount,
  }
}

export async function loadCatalogParts(workspaceRoot: string): Promise<CatalogPart[]> {
  return (await inspectCatalog(workspaceRoot)).parts
}

export function filterCatalogParts(parts: CatalogPart[], query?: string): CatalogPart[] {
  const q = query?.trim().toLowerCase()
  if (!q) return parts
  return parts.filter((p) => JSON.stringify(p).toLowerCase().includes(q))
}

export function findCatalogPart(parts: CatalogPart[], mpn: string): CatalogPart | null {
  const normalized = mpn.trim().toLowerCase()
  if (!normalized) return null
  return parts.find((part) => part.mpn.trim().toLowerCase() === normalized) ?? null
}

export async function getCatalogPart(workspaceRoot: string, mpn: string): Promise<CatalogPart | null> {
  return findCatalogPart((await inspectCatalog(workspaceRoot)).parts, mpn)
}

export type CatalogUpsertInput = {
  mpn: string
  manufacturer?: string | null
  description?: string | null
  datasheet?: string | null
  category?: string | null
  /** When true, replace existing file fields; default merges non-empty input over existing. */
  replace?: boolean
}

export type CatalogUpsertResult =
  | { ok: true; created: boolean; path: string; part: CatalogPart }
  | { ok: false; error: string; code: "invalid_mpn" | "invalid_datasheet" | "write_failed" | "catalog_full" }

function optionalTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Map display MPN → catalog filename. Plain when possible; else percent-encode (keeps `/`, spaces, etc.). */
export function catalogFileName(mpn: string): string | null {
  const trimmed = mpn.trim()
  if (!trimmed || trimmed.includes("\0") || trimmed.includes("..")) return null
  if (trimmed.length > MAX_MPN_FILE_CHARS) return null
  if (PLAIN_MPN_FILE_RE.test(trimmed)) return `${trimmed}.yaml`
  const encoded = encodeURIComponent(trimmed)
  if (!encoded || encoded.length > MAX_MPN_FILE_CHARS * 3) return null
  if (!isSafeCatalogStem(encoded)) return null
  return `${encoded}.yaml`
}

/** Locate on-disk catalog file for an MPN (case-insensitive identity). */
async function findCatalogPartRecord(workspaceRoot: string, mpn: string): Promise<{ fileName: string; part: CatalogPart } | null> {
  const target = mpn.trim().toLowerCase()
  if (!target) return null
  const dir = catalogPartsDir(workspaceRoot)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }

  const yamlFiles = entries.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).sort()
  for (const file of yamlFiles) {
    const stem = path.basename(file, path.extname(file))
    if (!isSafeCatalogStem(stem)) continue
    const mpnFallback = mpnFromFilename(file)
    const filePath = path.join(dir, file)
    if (!isInside(workspaceRoot, filePath)) continue
    try {
      const info = await lstat(filePath)
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_PART_FILE_BYTES) continue
      const content = await readFile(filePath, "utf8")
      const part = parsePart(yaml.load(content), mpnFallback)
      if (part.mpn.trim().toLowerCase() === target || mpnFallback.toLowerCase() === target) {
        return { fileName: file, part }
      }
    } catch {
      // skip unreadable / malformed
    }
  }
  return null
}

function serializePart(part: CatalogPart): string {
  const body: Record<string, unknown> = { mpn: part.mpn }
  if (part.manufacturer) body.manufacturer = part.manufacturer
  if (part.description) body.description = part.description
  if (part.category) body.category = part.category
  if (part.datasheet) body.datasheet = part.datasheet
  for (const [key, value] of Object.entries(part)) {
    if (KNOWN_PART_KEYS.has(key)) continue
    if (isScalarExtra(value) || (Array.isArray(value) && value.every((item) => isScalarExtra(item) || item === null))) {
      body[key] = value
    }
  }
  return yaml.dump(body, { lineWidth: 100, noRefs: true, sortKeys: true })
}

/** Write or merge a verified part into `catalog/parts/<mpn>.yaml`. */
export async function upsertCatalogPart(workspaceRoot: string, input: CatalogUpsertInput): Promise<CatalogUpsertResult> {
  const mpn = optionalTrimmed(input.mpn)
  if (!mpn) return { ok: false, error: "mpn is required", code: "invalid_mpn" }
  if (!catalogFileName(mpn)) {
    return {
      ok: false,
      error: "mpn is empty, too long, or contains unsupported characters for catalog storage",
      code: "invalid_mpn",
    }
  }

  const datasheetRaw = optionalTrimmed(input.datasheet ?? undefined)
  const datasheet = datasheetRaw ? safeExternalHref(datasheetRaw) : undefined
  if (datasheetRaw && !datasheet) {
    return { ok: false, error: "datasheet must be an http(s) URL", code: "invalid_datasheet" }
  }

  const dir = catalogPartsDir(workspaceRoot)
  const existingRecord = await findCatalogPartRecord(workspaceRoot, mpn)
  // Keep first-seen on-disk filename/casing so case variants merge into one identity.
  const fileName = existingRecord?.fileName ?? catalogFileName(mpn)
  if (!fileName) {
    return {
      ok: false,
      error: "mpn is empty, too long, or contains unsupported characters for catalog storage",
      code: "invalid_mpn",
    }
  }
  const filePath = path.join(dir, fileName)
  if (!isInside(workspaceRoot, filePath)) {
    return { ok: false, error: "catalog path escapes workspace", code: "write_failed" }
  }

  if (!existingRecord) {
    const state = await inspectCatalog(workspaceRoot)
    if (state.parts.length >= MAX_CATALOG_PARTS) {
      return { ok: false, error: `catalog already has ${MAX_CATALOG_PARTS} parts`, code: "catalog_full" }
    }
  }

  const canonicalMpn = existingRecord?.part.mpn ?? mpn
  const incoming: CatalogPart = {
    mpn: canonicalMpn,
    ...(optionalTrimmed(input.manufacturer ?? undefined) ? { manufacturer: optionalTrimmed(input.manufacturer ?? undefined) } : {}),
    ...(optionalTrimmed(input.description ?? undefined) ? { description: optionalTrimmed(input.description ?? undefined) } : {}),
    ...(optionalTrimmed(input.category ?? undefined) ? { category: optionalTrimmed(input.category ?? undefined) } : {}),
    ...(datasheet ? { datasheet } : {}),
  }

  const existing = existingRecord?.part
  const part: CatalogPart =
    input.replace || !existing
      ? incoming
      : {
          ...existing,
          mpn: canonicalMpn,
          ...(incoming.manufacturer ? { manufacturer: incoming.manufacturer } : {}),
          ...(incoming.description ? { description: incoming.description } : {}),
          ...(incoming.category ? { category: incoming.category } : {}),
          ...(incoming.datasheet ? { datasheet: incoming.datasheet } : {}),
        }

  try {
    await mkdir(dir, { recursive: true })
    const yamlText = serializePart(part)
    if (Buffer.byteLength(yamlText, "utf8") > MAX_PART_FILE_BYTES) {
      return { ok: false, error: "part file exceeds size limit", code: "write_failed" }
    }
    await writeFile(filePath, yamlText, "utf8")
    return {
      ok: true,
      created: !existingRecord,
      path: path.join(CATALOG_SUBDIR, fileName),
      part,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: "write_failed",
    }
  }
}

export function partSummary(part: CatalogPart) {
  return {
    mpn: part.mpn,
    manufacturer: part.manufacturer ?? null,
    description: part.description ?? null,
    category: part.category ?? null,
    datasheet: part.datasheet ?? null,
  }
}
