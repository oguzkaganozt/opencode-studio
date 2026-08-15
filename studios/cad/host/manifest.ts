import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { resolveArtifactGeneration } from "./artifacts"

export const DESIGN_SCHEMA = 1
/** On-disk artifact engine id (must match engine/cad_build.py). Keep stable. */
export const CAD_BUILD_ENGINE = "forge-cad/1"
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export type DesignPart = {
  id: string
  source: string
  qty: 1 | 2
}

export type DesignManifest = {
  schema: 1
  id: string
  params?: string
  parts: DesignPart[]
}

export type ArtifactPart = {
  id: string
  files: {
    step: string
    stl: string
    glb: string
    /** Face-index map for viewer pick (optional on legacy builds). */
    topo?: string
  }
  metrics: {
    volume_mm3: number
    size_mm: { x: number; y: number; z: number }
    bounds_mm?: { min: [number, number, number]; max: [number, number, number] }
    solid_count?: number
    face_count?: number
  }
}

export type ArtifactManifest = {
  schema: 1
  id: string
  parts: ArtifactPart[]
  build: {
    engine: string
    inputs: Record<string, string>
  }
}

export class ManifestError extends Error {}

function validatePartSource(source: unknown, partId: string) {
  if (typeof source !== "string" || !source.endsWith(".py")) {
    throw new ManifestError(`Part ${partId} must reference a Python source file`)
  }
  const normalized = source.replaceAll("\\", "/")
  if (
    !normalized.startsWith("parts/") ||
    normalized.startsWith("/") ||
    normalized.split("/").some((component) => component === ".." || component === ".")
  ) {
    throw new ManifestError(`Part ${partId} source must be a safe relative path under parts/`)
  }
  return normalized
}

function validateParamsSource(source: unknown) {
  if (source === undefined) return undefined
  if (source !== "params.py") throw new ManifestError("params must be params.py")
  const normalized = source.replaceAll("\\", "/")
  if (normalized.startsWith("/") || normalized.split("/").some((component) => component === ".." || component === ".")) {
    throw new ManifestError("params must be a safe relative path")
  }
  return normalized
}

function finitePositive(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new ManifestError(`${label} must be a finite positive number`)
  return value
}

function finiteVector(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new ManifestError(`${label} must be an array of three finite numbers`)
  }
  return value as [number, number, number]
}

export function artifactRevision(artifact: Pick<ArtifactManifest, "build">): string {
  const inputs = Object.entries(artifact.build.inputs).sort(([a], [b]) => a.localeCompare(b))
  return createHash("sha256")
    .update(JSON.stringify([artifact.build.engine, inputs]))
    .digest("hex")
}

export async function readDesignManifest(designDir: string, expectedId?: string): Promise<DesignManifest> {
  const manifestPath = path.join(designDir, "design.json")
  let text: string
  try {
    text = await readFile(manifestPath, "utf8")
  } catch {
    throw new ManifestError(`Missing design.json: ${manifestPath}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ManifestError(`Invalid JSON in design.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  const manifest = validateDesignManifest(parsed)
  if (expectedId !== undefined && manifest.id !== expectedId)
    throw new ManifestError(`Design id ${manifest.id} does not match directory id ${expectedId}`)
  return manifest
}

export function validateDesignManifest(value: unknown): DesignManifest {
  if (typeof value !== "object" || value === null) throw new ManifestError("design.json must be an object")
  const obj = value as Record<string, unknown>
  if (obj.schema !== DESIGN_SCHEMA) throw new ManifestError("design.json must use schema 1")
  const id = obj.id
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new ManifestError("Design id must use lowercase letters, numbers, hyphens, or underscores")
  }
  const parts = obj.parts
  if (!Array.isArray(parts) || parts.length === 0) throw new ManifestError("design.json must define at least one part")
  const seen = new Set<string>()
  const normalizedParts: DesignPart[] = []
  for (const part of parts) {
    if (typeof part !== "object" || part === null) throw new ManifestError("Each part must be an object")
    const p = part as Record<string, unknown>
    const partId = p.id
    if (typeof partId !== "string" || !ID_PATTERN.test(partId)) throw new ManifestError(`Invalid part id: ${String(partId)}`)
    if (seen.has(partId)) throw new ManifestError(`Duplicate part id: ${partId}`)
    const source = validatePartSource(p.source, partId)
    const qty = p.qty === undefined || p.qty === 1 ? 1 : p.qty === 2 ? 2 : null
    if (qty === null) throw new ManifestError(`Part ${partId} qty must be 1 or 2`)
    seen.add(partId)
    normalizedParts.push({ id: partId, source, qty })
  }
  for (const part of normalizedParts) {
    if (part.qty === 2 && seen.has(`${part.id}_mirror`)) {
      throw new ManifestError(`Part ${part.id} qty 2 collides with existing id ${part.id}_mirror`)
    }
  }
  const params = validateParamsSource(obj.params)
  return { schema: DESIGN_SCHEMA, id, params, parts: normalizedParts }
}

export async function readArtifactManifest(designDir: string, expectedId?: string): Promise<ArtifactManifest | null> {
  const manifestPath = path.join(designDir, "manifest.json")
  let text: string
  try {
    text = await readFile(manifestPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ManifestError(`Could not read manifest.json: ${error instanceof Error ? error.message : String(error)}`)
    }
    const generation = await resolveArtifactGeneration(designDir)
    if (!generation) return null
    try {
      text = await readFile(path.join(designDir, ".artifacts", generation, "manifest.json"), "utf8")
    } catch {
      return null
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ManifestError(`Invalid JSON in manifest.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  const manifest = validateArtifactManifest(parsed)
  if (expectedId !== undefined && manifest.id !== expectedId)
    throw new ManifestError(`Artifact id ${manifest.id} does not match design id ${expectedId}`)
  return manifest
}

export function validateArtifactManifest(value: unknown): ArtifactManifest {
  if (typeof value !== "object" || value === null) throw new ManifestError("manifest.json must be an object")
  const obj = value as Record<string, unknown>
  if (obj.schema !== DESIGN_SCHEMA) throw new ManifestError("manifest.json must use schema 1")
  const id = obj.id
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new ManifestError("Invalid artifact id")
  const parts = obj.parts
  if (!Array.isArray(parts) || parts.length === 0) throw new ManifestError("manifest.json must define at least one part")
  const seen = new Set<string>()
  for (const part of parts) {
    if (typeof part !== "object" || part === null) throw new ManifestError("Each artifact part must be an object")
    const p = part as Record<string, unknown>
    const partId = p.id
    if (typeof partId !== "string" || !ID_PATTERN.test(partId)) throw new ManifestError(`Invalid artifact part id: ${String(partId)}`)
    if (seen.has(partId)) throw new ManifestError(`Duplicate artifact part id: ${partId}`)
    seen.add(partId)
    const files = p.files
    if (typeof files !== "object" || files === null) throw new ManifestError(`Part ${partId} missing files`)
    const f = files as Record<string, unknown>
    for (const extension of ["step", "stl", "glb"] as const) {
      const expected = `${extension}/${partId}.${extension}`
      if (f[extension] !== expected) throw new ManifestError(`Part ${partId} ${extension} path must be ${expected}`)
    }
    if (f.topo !== undefined && f.topo !== `topo/${partId}.json`) {
      throw new ManifestError(`Part ${partId} topo path must be topo/${partId}.json`)
    }
    const metrics = p.metrics
    if (typeof metrics !== "object" || metrics === null) throw new ManifestError(`Part ${partId} missing metrics`)
    const metric = metrics as Record<string, unknown>
    finitePositive(metric.volume_mm3, `Part ${partId} volume_mm3`)
    if (typeof metric.size_mm !== "object" || metric.size_mm === null) throw new ManifestError(`Part ${partId} missing size_mm`)
    const size = metric.size_mm as Record<string, unknown>
    for (const axis of ["x", "y", "z"] as const) finitePositive(size[axis], `Part ${partId} size_mm.${axis}`)
    if (metric.bounds_mm !== undefined) {
      if (typeof metric.bounds_mm !== "object" || metric.bounds_mm === null) throw new ManifestError(`Part ${partId} has invalid bounds_mm`)
      const bounds = metric.bounds_mm as Record<string, unknown>
      const min = finiteVector(bounds.min, `Part ${partId} bounds_mm.min`)
      const max = finiteVector(bounds.max, `Part ${partId} bounds_mm.max`)
      if (min.some((value, index) => value >= max[index]))
        throw new ManifestError(`Part ${partId} bounds_mm max must exceed min on every axis`)
    }
    if (
      metric.solid_count !== undefined &&
      (typeof metric.solid_count !== "number" || !Number.isInteger(metric.solid_count) || metric.solid_count <= 0)
    ) {
      throw new ManifestError(`Part ${partId} solid_count must be a positive integer`)
    }
    if (
      metric.face_count !== undefined &&
      (typeof metric.face_count !== "number" || !Number.isInteger(metric.face_count) || metric.face_count <= 0)
    ) {
      throw new ManifestError(`Part ${partId} face_count must be a positive integer`)
    }
  }
  const build = obj.build
  if (typeof build !== "object" || build === null) throw new ManifestError("manifest.json missing build metadata")
  const buildRecord = build as Record<string, unknown>
  if (buildRecord.engine !== CAD_BUILD_ENGINE) throw new ManifestError(`Unsupported CAD build engine: ${String(buildRecord.engine)}`)
  if (typeof buildRecord.inputs !== "object" || buildRecord.inputs === null || Array.isArray(buildRecord.inputs)) {
    throw new ManifestError("manifest.json build inputs must be an object")
  }
  const inputs = buildRecord.inputs as Record<string, unknown>
  if (Object.keys(inputs).length === 0) throw new ManifestError("manifest.json build inputs cannot be empty")
  for (const [file, hash] of Object.entries(inputs)) {
    const normalized = file.replaceAll("\\", "/")
    if (normalized.startsWith("/") || normalized.split("/").some((component) => component === ".." || component === ".")) {
      throw new ManifestError(`Unsafe build input path: ${file}`)
    }
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new ManifestError(`Invalid SHA-256 for build input: ${file}`)
  }
  return value as ArtifactManifest
}

export function expectedArtifactPartIds(parts: Array<{ id: string; qty?: 1 | 2 }>): string[] {
  return parts.flatMap((part) => (part.qty === 2 ? [part.id, `${part.id}_mirror`] : [part.id])).sort()
}

export function scaffoldDesignManifest(id: string, parts: Array<{ id: string; source?: string; qty?: 1 | 2 }>): DesignManifest {
  if (!ID_PATTERN.test(id)) throw new ManifestError(`Invalid design id: ${id}`)
  const seen = new Set<string>()
  const resolvedParts: DesignPart[] = []
  for (const part of parts) {
    if (!ID_PATTERN.test(part.id)) throw new ManifestError(`Invalid part id: ${part.id}`)
    if (seen.has(part.id)) throw new ManifestError(`Duplicate part id: ${part.id}`)
    seen.add(part.id)
    const source = validatePartSource(part.source ?? `parts/${part.id.replace(/-/g, "_")}.py`, part.id)
    const qty = part.qty === 2 ? 2 : 1
    resolvedParts.push({ id: part.id, source, qty })
  }
  const declared = new Set(resolvedParts.map((part) => part.id))
  for (const part of resolvedParts) {
    if (part.qty === 2 && declared.has(`${part.id}_mirror`)) {
      throw new ManifestError(`Part ${part.id} qty 2 collides with existing id ${part.id}_mirror`)
    }
  }
  return { schema: DESIGN_SCHEMA, id, params: "params.py", parts: resolvedParts }
}
