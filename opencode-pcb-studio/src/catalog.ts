import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

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

function catalogPartsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, CATALOG_SUBDIR)
}

function mpnFromFilename(filename: string): string {
  return path.basename(filename, path.extname(filename))
}

function parsePart(raw: unknown, mpnFallback: string): CatalogPart {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { mpn: mpnFallback }
  }
  const record = raw as Record<string, unknown>
  return {
    mpn: typeof record.mpn === "string" ? record.mpn : mpnFallback,
    ...record,
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

  for (const file of yamlFiles) {
    try {
      const content = await readFile(path.join(dir, file), "utf8")
      const raw = yaml.load(content)
      parts.push(parsePart(raw, mpnFromFilename(file)))
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
    skippedCount: entries.length - yamlFiles.length,
  }
}

export async function loadCatalogParts(workspaceRoot: string): Promise<CatalogPart[]> {
  return (await inspectCatalog(workspaceRoot)).parts
}

export async function getCatalogPart(workspaceRoot: string, mpn: string): Promise<CatalogPart | null> {
  if (!mpn || mpn.includes("/") || mpn.includes("\\") || mpn.includes("\0")) return null
  const dir = catalogPartsDir(workspaceRoot)

  for (const ext of [".yml", ".yaml"]) {
    const filePath = path.join(dir, `${mpn}${ext}`)
    try {
      const content = await readFile(filePath, "utf8")
      const raw = yaml.load(content)
      return parsePart(raw, mpn)
    } catch {
      // try next extension
    }
  }

  // Fallback: scan all parts for matching mpn field
  const parts = await loadCatalogParts(workspaceRoot)
  return parts.find((p) => p.mpn.toLowerCase() === mpn.toLowerCase()) ?? null
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
