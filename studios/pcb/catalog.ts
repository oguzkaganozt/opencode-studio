import { lstat, readdir, readFile } from "node:fs/promises"
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
const MPN_FILE_RE = /^[A-Za-z0-9._+-]+$/

function catalogPartsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, CATALOG_SUBDIR)
}

function mpnFromFilename(filename: string): string {
  return path.basename(filename, path.extname(filename))
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
    const mpnFallback = mpnFromFilename(file)
    if (!MPN_FILE_RE.test(mpnFallback) || mpnFallback.includes("..")) {
      skippedCount++
      continue
    }
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

export function partSummary(part: CatalogPart) {
  return {
    mpn: part.mpn,
    manufacturer: part.manufacturer ?? null,
    description: part.description ?? null,
    category: part.category ?? null,
    datasheet: part.datasheet ?? null,
  }
}
