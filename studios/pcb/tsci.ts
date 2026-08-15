import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { engineCommand, resolveTsci } from "../../src/core/engines"
import {
  artifactFreshness,
  buildInputDigest,
  circuitJsonUntampered,
  clearBuildInputStamp,
  staleArtifactMessage,
  tamperedArtifactMessage,
  writeBuildInputStamp,
} from "./artifact-freshness"
import {
  type CircuitInspection,
  inspectCircuitJson,
  type ManufacturingBlocker,
  manufacturingBlockers,
  readCircuitJson,
} from "./circuit-json"
import {
  COMPONENT_EVIDENCE_SCHEMA,
  type ComponentEvidenceRecord,
  createComponentEvidence,
  type PackageProvenance,
  readComponentEvidence,
  writeComponentEvidence,
} from "./component-evidence"
import { loadNoConnectIntents } from "./tsx-intent"

export type TsciResult = {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
}

export type ComponentSearchScope = "all" | "jlcpcb" | "tscircuit" | "kicad"

export type ComponentLoadability = {
  status: "loadable" | "unavailable" | "unknown"
  reason: string
  checkedUrl?: string
}

export type ComponentCandidateVerification = {
  status: "unverified" | "verified" | "rejected"
  reason: string
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type ComponentSearchEntry =
  | {
      source: "jlcpcb"
      exactMatch: boolean
      lcscPartNumber: string
      manufacturerPartNumber: string
      packageDescription: string
      description: string | null
      stock: number | null
      unitPrice: number | null
      isBasic: boolean
      isPreferred: boolean
      supplierPartNumbers: { jlcpcb: string[] }
      loadability: ComponentLoadability
    }
  | {
      source: "tscircuit"
      exactMatch: boolean
      packageName: string
      version: string | null
      description: string | null
      usageInstructions: string | null
      starCount: number | null
      hasPublicDist: boolean
      loadability: ComponentLoadability
      candidateId: string | null
      packageSpec: string | null
      importStatement: string | null
      exportName: string | null
    }
  | {
      source: "kicad"
      exactMatch: boolean
      path: string
      footprint: string | null
      loadability: ComponentLoadability
    }

export type ComponentSearchResult = TsciResult & {
  processSuccess: boolean
  query: string
  resolvedQuery: string
  attemptedQueries: string[]
  fallbackUsed: boolean
  scope: ComponentSearchScope
  results: ComponentSearchEntry[]
  cacheHit: boolean
}

export function isUsableSearchEntry(entry: ComponentSearchEntry, projectDir?: string): boolean {
  return entry.source === "tscircuit" && entry.candidateId !== null && candidateVerification(entry, projectDir).status === "verified"
}

export function isInstallableSearchEntry(entry: ComponentSearchEntry, projectDir?: string): boolean {
  return entry.source === "tscircuit" && entry.candidateId !== null && candidateVerification(entry, projectDir).status === "unverified"
}

export function isFootprintOnlySearchEntry(entry: ComponentSearchEntry): boolean {
  return entry.source === "kicad" && Boolean(entry.footprint)
}

export function partitionSearchEntries(
  entries: ComponentSearchEntry[],
  projectDir?: string,
): {
  usable: ComponentSearchEntry[]
  candidates: ComponentSearchEntry[]
  rejected: ComponentSearchEntry[]
  footprintOnly: ComponentSearchEntry[]
  catalogOnly: ComponentSearchEntry[]
} {
  const usable: ComponentSearchEntry[] = []
  const candidates: ComponentSearchEntry[] = []
  const rejected: ComponentSearchEntry[] = []
  const footprintOnly: ComponentSearchEntry[] = []
  const catalogOnly: ComponentSearchEntry[] = []
  for (const entry of entries) {
    if (isUsableSearchEntry(entry, projectDir)) usable.push(entry)
    else if (isInstallableSearchEntry(entry, projectDir)) candidates.push(entry)
    else if (entry.source === "tscircuit" && entry.candidateId && candidateVerification(entry, projectDir).status === "rejected")
      rejected.push(entry)
    else if (isFootprintOnlySearchEntry(entry)) footprintOnly.push(entry)
    else catalogOnly.push(entry)
  }
  return { usable, candidates, rejected, footprintOnly, catalogOnly }
}

export type BuildArtifacts = {
  circuitJsonPath: string | null
  schematicSvgPath: string | null
  pcbSvgPath: string | null
  gerbersZipPath: string | null
}

export type CircuitBuildResult = TsciResult & {
  processSuccess: boolean
  artifacts: BuildArtifacts
  inspection: CircuitInspection | null
}

export type BuildDiagnosticSummary = {
  rootCause: "package" | "component_identity" | "footprint" | "connectivity" | "circuit" | null
  package: string[]
  componentIdentity: string[]
  footprint: string[]
  connectivity: string[]
  circuit: string[]
}

export function classifyBuildDiagnostics(
  result: Pick<CircuitBuildResult, "stderr" | "inspection">,
  blockers: readonly ManufacturingBlocker[] = [],
): BuildDiagnosticSummary {
  const summary: BuildDiagnosticSummary = {
    rootCause: null,
    package: [],
    componentIdentity: [],
    footprint: [],
    connectivity: [],
    circuit: [],
  }
  const packagePattern =
    /cannot find (?:package|module)|module_not_found|could not resolve|failed to resolve import|does not provide an export/i
  const footprintPattern = /footprint|pcb[_ ]port|\bpad\b|copper iou/i
  if (result.stderr.trim()) {
    if (packagePattern.test(result.stderr)) summary.package.push(result.stderr.trim().slice(0, 2000))
    else if (footprintPattern.test(result.stderr)) summary.footprint.push(result.stderr.trim().slice(0, 2000))
    else summary.circuit.push(result.stderr.trim().slice(0, 2000))
  }
  for (const group of result.inspection?.errors ?? []) {
    const messages = group.messages.length > 0 ? group.messages : [group.type]
    const destination = packagePattern.test(`${group.type} ${messages.join(" ")}`)
      ? summary.package
      : footprintPattern.test(`${group.type} ${messages.join(" ")}`)
        ? summary.footprint
        : summary.circuit
    destination.push(...messages)
  }
  for (const blocker of blockers) {
    const destination =
      blocker.type === "unverified_part" || blocker.type === "placeholder_component"
        ? summary.componentIdentity
        : blocker.type === "unconnected_pin"
          ? summary.connectivity
          : blocker.type === "missing_pcb_port" || blocker.type === "supplier_footprint_mismatch"
            ? summary.footprint
            : summary.circuit
    destination.push(...blocker.messages)
  }
  for (const key of ["package", "componentIdentity", "footprint", "connectivity", "circuit"] as const) {
    summary[key] = [...new Set(summary[key])]
  }
  summary.rootCause =
    summary.package.length > 0
      ? "package"
      : summary.componentIdentity.length > 0
        ? "component_identity"
        : summary.footprint.length > 0
          ? "footprint"
          : summary.connectivity.length > 0
            ? "connectivity"
            : summary.circuit.length > 0
              ? "circuit"
              : null
  return summary
}

export type CircuitExportResult = TsciResult & {
  processSuccess: boolean
  artifactGenerationSucceeded: boolean
  designValid: boolean
  debugOnly: boolean
  generatedFormats: Array<"schematic" | "pcb" | "gerber">
  blockedFormats: Array<"gerber">
  manufacturingBlockers: ManufacturingBlocker[]
  artifacts: BuildArtifacts
  inspection: CircuitInspection
}

function artifactPaths(projectDir: string): BuildArtifacts {
  return {
    circuitJsonPath: path.join(projectDir, "dist", "src", "circuit", "circuit.json"),
    schematicSvgPath: path.join(projectDir, "dist", "schematic.svg"),
    pcbSvgPath: path.join(projectDir, "dist", "pcb.svg"),
    gerbersZipPath: path.join(projectDir, "dist", "circuit-gerbers.zip"),
  }
}

async function clearGeneratedArtifacts(projectDir: string): Promise<void> {
  const paths = Object.values(artifactPaths(projectDir)).filter((filePath): filePath is string => filePath !== null)
  await Promise.all(paths.map((filePath) => rm(filePath, { force: true })))
  await clearBuildInputStamp(projectDir)
}

async function assertFreshCircuitJson(projectDir: string, circuitJsonPath: string): Promise<void> {
  await readCircuitJson(projectDir, circuitJsonPath)
  const freshness = await artifactFreshness(projectDir)
  if (!freshness.fresh) throw new Error(staleArtifactMessage(freshness.reason))
}

async function runCommand(command: string[], cwd: string, signal?: AbortSignal): Promise<TsciResult> {
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    signal,
  })

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])

  return { success: exitCode === 0, stdout, stderr, exitCode }
}

async function run(args: string[], cwd: string, signal?: AbortSignal): Promise<TsciResult> {
  const engine = resolveTsci()
  if (engine) return runCommand([...engineCommand(engine), ...args], cwd, signal)
  // Last resort: npx (offline installs should hit the bundled tscircuit dependency).
  return runCommand(["npx", "--yes", "tsci", ...args], cwd, signal)
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

type ComponentCandidate = {
  id: string
  packageName: string
  version: string
  packageSpec: string
  importStatement: string
  exportName: string
  usageInstructions: string
}

const componentCandidates = new Map<string, ComponentCandidate>()
const componentCandidateVerifications = new Map<string, ComponentCandidateVerification>()

function candidateVerificationKey(candidateId: string, projectDir?: string): string {
  return `${projectDir ? path.resolve(projectDir) : "unscoped"}\0${candidateId}`
}

function candidateVerification(entry: ComponentSearchEntry, projectDir?: string): ComponentCandidateVerification {
  if (entry.source !== "tscircuit" || !entry.candidateId) return { status: "rejected", reason: "not_installable" }
  return (
    componentCandidateVerifications.get(candidateVerificationKey(entry.candidateId, projectDir)) ?? {
      status: "unverified",
      reason: "requires_component_add",
    }
  )
}

export function componentSearchEntryVerification(entry: ComponentSearchEntry, projectDir?: string): ComponentCandidateVerification {
  return candidateVerification(entry, projectDir)
}

function parseUsageImport(usageInstructions: string | null): {
  packageSpec: string
  importStatement: string
  exportName: string
} | null {
  if (!usageInstructions) return null
  const match = usageInstructions.match(
    /import\s+(\{\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}|([A-Za-z_$][\w$]*))\s+from\s+["'](@tsci\/[A-Za-z0-9._/-]+)["']/,
  )
  if (!match) return null
  const exportName = match[3] ?? match[2] ?? match[4]
  if (!exportName) return null
  return { packageSpec: match[5]!, importStatement: match[0], exportName }
}

function registerComponentCandidate(input: {
  packageName: string
  version: string | null
  usageInstructions: string | null
}): Pick<ComponentCandidate, "id" | "packageSpec" | "importStatement" | "exportName"> | null {
  if (!input.version || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.version)) return null
  const parsed = parseUsageImport(input.usageInstructions)
  if (!parsed) return null
  const expectedPackageSpec = `@tsci/${input.packageName.replace("/", ".")}`
  if (parsed.packageSpec.toLowerCase() !== expectedPackageSpec.toLowerCase()) return null
  const id = createHash("sha256").update(`${parsed.packageSpec}\0${input.version}\0${parsed.exportName}`).digest("hex").slice(0, 20)
  componentCandidates.set(id, {
    id,
    packageName: input.packageName,
    version: input.version,
    usageInstructions: input.usageInstructions!,
    ...parsed,
  })
  return { id, ...parsed }
}

export function kicadFootprint(pathValue: string): string | null {
  const match = pathValue.match(/^(.+)\.pretty\/(.+)\.kicad_mod$/)
  return match ? `kicad:${match[1]}/${match[2]}` : null
}

export function kicadCacheUrl(pathValue: string): string | null {
  const segments = pathValue.replace(/^\/+/, "").split("/")
  if (
    segments.length !== 2 ||
    !segments[0].endsWith(".pretty") ||
    !segments[1].endsWith(".kicad_mod") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null
  }
  return `https://kicad-mod-cache.tscircuit.com/${segments.map(encodeURIComponent).join("/")}`
}

export function classifyRegistryLoadability(result: Record<string, unknown>): ComponentLoadability {
  const publicDistEnabled = optionalBoolean(result.public_dist_enabled) ?? optionalBoolean(result.has_public_dist)
  const hasRelease =
    optionalString(result.latest_version) !== null &&
    (optionalString(result.latest_package_release_id) !== null || optionalString(result.latest_package_release_fs_sha) !== null)
  return publicDistEnabled === true && hasRelease
    ? { status: "loadable", reason: "public_registry_release" }
    : { status: "unknown", reason: "public_release_not_confirmed" }
}

export async function probeKicadLoadability(
  pathValue: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<ComponentLoadability> {
  const checkedUrl = kicadCacheUrl(pathValue)
  if (!checkedUrl) return { status: "unknown", reason: "invalid_kicad_path" }
  try {
    const probeSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000)
    let response = await fetchImpl(checkedUrl, { method: "HEAD", signal: probeSignal })
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(checkedUrl, { method: "GET", headers: { Range: "bytes=0-0" }, signal: probeSignal })
    }
    if (response.ok) return { status: "loadable", reason: "kicad_cache_hit", checkedUrl }
    if (response.status === 404 || response.status === 410) {
      return { status: "unavailable", reason: "kicad_cache_miss", checkedUrl }
    }
    return { status: "unknown", reason: `kicad_cache_http_${response.status}`, checkedUrl }
  } catch {
    return { status: "unknown", reason: "kicad_cache_probe_failed", checkedUrl }
  }
}

function normalizedPartId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function componentSearchFallbackQuery(query: string): string | null {
  const normalizedQuery = query.trim()
  const family = normalizedQuery.replace(/[-_](?:N\d+(?:R\d+)?|R\d+)$/i, "")
  if (family !== normalizedQuery && family.length >= 5) return family
  const candidates = normalizedQuery.match(/[A-Za-z][A-Za-z0-9._+-]*/g) ?? []
  return (
    candidates.find((candidate) => {
      const letterCount = candidate.match(/[A-Za-z]/g)?.length ?? 0
      return candidate.length >= 5 && letterCount >= 2 && /\d/.test(candidate) && candidate !== normalizedQuery
    }) ?? null
  )
}

export function parseComponentSearchOutput(stdout: string): { query: string; results: ComponentSearchEntry[] } {
  const parsed: unknown = JSON.parse(stdout)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Search output must be an object")
  const value = parsed as Record<string, unknown>
  if (typeof value.query !== "string" || !Array.isArray(value.results)) {
    throw new Error("Search output must contain a query and results array")
  }
  const parsedQuery = value.query

  const results = value.results.map((item, index): ComponentSearchEntry => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Search result ${index} must be an object`)
    const result = item as Record<string, unknown>

    if (result.source === "jlcpcb") {
      if (typeof result.lcsc !== "number" || typeof result.mfr !== "string" || typeof result.package !== "string") {
        throw new Error(`JLCPCB search result ${index} is missing required fields`)
      }
      const lcscPartNumber = `C${result.lcsc}`
      return {
        source: "jlcpcb",
        exactMatch: [lcscPartNumber, result.mfr].some((candidate) => normalizedPartId(candidate) === normalizedPartId(parsedQuery)),
        lcscPartNumber,
        manufacturerPartNumber: result.mfr,
        packageDescription: result.package,
        description: optionalString(result.description),
        stock: optionalNumber(result.stock),
        unitPrice: optionalNumber(result.price),
        isBasic: result.is_basic === true,
        isPreferred: result.is_preferred === true,
        supplierPartNumbers: { jlcpcb: [lcscPartNumber] },
        loadability: { status: "unknown", reason: "jlcpcb_search_metadata_only" },
      }
    }

    if (result.source === "tscircuit") {
      if (typeof result.name !== "string") throw new Error(`tscircuit search result ${index} is missing a package name`)
      const version = optionalString(result.latest_version)
      const usageInstructions = optionalString(result.ai_usage_instructions)
      const candidate = registerComponentCandidate({ packageName: result.name, version, usageInstructions })
      return {
        source: "tscircuit",
        exactMatch: normalizedPartId(result.name.split("/").at(-1) ?? result.name) === normalizedPartId(parsedQuery),
        packageName: result.name,
        version,
        description: optionalString(result.ai_description) ?? optionalString(result.description),
        usageInstructions,
        starCount: optionalNumber(result.star_count),
        hasPublicDist: (optionalBoolean(result.public_dist_enabled) ?? optionalBoolean(result.has_public_dist)) === true,
        loadability: classifyRegistryLoadability(result),
        candidateId: candidate?.id ?? null,
        packageSpec: candidate?.packageSpec ?? null,
        importStatement: candidate?.importStatement ?? null,
        exportName: candidate?.exportName ?? null,
      }
    }

    if (result.source === "kicad") {
      if (typeof result.path !== "string") throw new Error(`KiCad search result ${index} is missing a footprint path`)
      const footprint = kicadFootprint(result.path)
      const footprintName = footprint?.split("/").at(-1) ?? footprint
      return {
        source: "kicad",
        exactMatch: footprintName !== null && normalizedPartId(footprintName) === normalizedPartId(parsedQuery),
        path: result.path,
        footprint,
        loadability: { status: "unknown", reason: "kicad_cache_not_checked" },
      }
    }

    throw new Error(`Search result ${index} has unsupported source '${String(result.source)}'`)
  })

  results.sort((a, b) => Number(b.exactMatch) - Number(a.exactMatch))
  return { query: parsedQuery, results }
}

async function annotateComponentLoadability(entries: ComponentSearchEntry[], signal?: AbortSignal): Promise<ComponentSearchEntry[]> {
  return Promise.all(
    entries.map(async (entry) =>
      entry.source === "kicad" ? { ...entry, loadability: await probeKicadLoadability(entry.path, fetch, signal) } : entry,
    ),
  )
}

let npmExecTail: Promise<void> = Promise.resolve()

export function serializeNpmExec<T>(operation: () => Promise<T>): Promise<T> {
  const result = npmExecTail.then(operation, operation)
  npmExecTail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function searchComponentsOnce(
  query: string,
  scope: ComponentSearchScope,
  searchCwd: string,
  signal?: AbortSignal,
): Promise<ComponentSearchResult> {
  const sourceArgs = scope === "all" ? [] : [`--${scope}`]
  const result = await serializeNpmExec(() => {
    signal?.throwIfAborted()
    // Prefer package-bundled tsci; run() falls back to npx if needed.
    return run(["search", ...sourceArgs, "--json", query], searchCwd, signal)
  })
  if (!result.success) {
    return {
      ...result,
      processSuccess: false,
      query,
      resolvedQuery: query,
      attemptedQueries: [query],
      fallbackUsed: false,
      scope,
      results: [],
      cacheHit: false,
    }
  }

  try {
    const parsed = parseComponentSearchOutput(result.stdout)
    const results = await annotateComponentLoadability(parsed.results, signal)
    return {
      ...result,
      processSuccess: true,
      query,
      resolvedQuery: parsed.query,
      attemptedQueries: [query],
      fallbackUsed: false,
      scope,
      results,
      cacheHit: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...result,
      success: false,
      processSuccess: true,
      query,
      resolvedQuery: query,
      attemptedQueries: [query],
      fallbackUsed: false,
      scope,
      results: [],
      cacheHit: false,
      stderr: [result.stderr, `Unable to parse tsci search JSON: ${message}`].filter(Boolean).join("\n"),
    }
  }
}

export function combineComponentSearchResults(query: string, results: ComponentSearchResult[]): ComponentSearchResult {
  const failed = results.find((result) => !result.success)
  const entries = results.flatMap((result) => result.results)
  entries.sort((a, b) => Number(b.exactMatch) - Number(a.exactMatch))
  return {
    success: failed === undefined,
    processSuccess: results.every((result) => result.processSuccess),
    query,
    resolvedQuery: query,
    attemptedQueries: [query],
    fallbackUsed: false,
    scope: "all",
    results: entries,
    cacheHit: false,
    stdout: results
      .map((result) => result.stdout)
      .filter(Boolean)
      .join("\n"),
    stderr: results
      .map((result) => result.stderr)
      .filter(Boolean)
      .join("\n"),
    exitCode: failed?.exitCode ?? 0,
  }
}

async function searchComponentsForScope(
  query: string,
  scope: ComponentSearchScope,
  searchCwd: string,
  signal?: AbortSignal,
): Promise<ComponentSearchResult> {
  if (scope !== "all") return searchComponentsOnce(query, scope, searchCwd, signal)
  const results = await Promise.all(
    (["jlcpcb", "tscircuit", "kicad"] as const).map((source) => searchComponentsOnce(query, source, searchCwd, signal)),
  )
  return combineComponentSearchResults(query, results)
}

const componentSearchCache = new Map<string, Promise<ComponentSearchResult>>()

export function normalizeComponentSearchQuery(query: string): string {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:usb[\s_-]*type[\s_-]*c|type[\s_-]*c|usb[\s_-]*c)\b/g, "usbc")
    .replace(/[_/+-]+/g, " ")
    .replace(/\b(?:smd|connector|receptacle|module|breakout)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ")
}

export function clearComponentSearchCache(): void {
  componentSearchCache.clear()
}

async function searchComponentsUncached(
  query: string,
  scope: ComponentSearchScope = "all",
  signal?: AbortSignal,
): Promise<ComponentSearchResult> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) throw new Error("Component search query must not be empty")
  const searchCwd = path.join(os.tmpdir(), "opencode-studio-tsci-search")
  await mkdir(searchCwd, { recursive: true })

  const initial = await searchComponentsForScope(normalizedQuery, scope, searchCwd, signal)
  const hasRegistryResult = initial.results.some((entry) => entry.source === "tscircuit")
  const shouldRetryRegistry = (scope === "all" || scope === "tscircuit") && !hasRegistryResult
  const fallbackQuery =
    initial.success && (initial.results.length === 0 || shouldRetryRegistry) ? componentSearchFallbackQuery(normalizedQuery) : null
  if (!fallbackQuery) return initial

  const fallback = await searchComponentsForScope(fallbackQuery, scope === "all" ? "tscircuit" : scope, searchCwd, signal)
  const attemptedQueries = [normalizedQuery, fallbackQuery]
  if (!fallback.success) {
    return {
      ...initial,
      attemptedQueries,
      stderr: [initial.stderr, `Fallback search '${fallbackQuery}' failed: ${fallback.stderr}`].filter(Boolean).join("\n"),
    }
  }
  const combined = combineComponentSearchResults(normalizedQuery, [initial, fallback])
  return { ...combined, query: normalizedQuery, resolvedQuery: fallbackQuery, attemptedQueries, fallbackUsed: true }
}

export async function searchComponents(
  query: string,
  scope: ComponentSearchScope = "all",
  signal?: AbortSignal,
): Promise<ComponentSearchResult> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) throw new Error("Component search query must not be empty")
  const key = `${scope}:${normalizeComponentSearchQuery(normalizedQuery)}`
  const cached = componentSearchCache.get(key)
  if (cached) return { ...(await cached), query: normalizedQuery, cacheHit: true }
  const pending = searchComponentsUncached(normalizedQuery, scope, signal)
  componentSearchCache.set(key, pending)
  try {
    return await pending
  } catch (error) {
    componentSearchCache.delete(key)
    throw error
  }
}

export type ComponentAddResult = {
  success: boolean
  candidateId: string
  packageName: string | null
  packageSpec: string | null
  version: string | null
  verified: boolean
  rolledBack: boolean
  importStatement: string | null
  exampleUsage: string | null
  reason: string
  stdout: string
  stderr: string
}

type ComponentAddOperations = {
  install?: (command: string[], cwd: string, signal?: AbortSignal) => Promise<TsciResult>
  smoke?: (projectDir: string, candidate: ComponentCandidate, signal?: AbortSignal) => Promise<ComponentSmokeResult>
}

type ComponentSmokeResult = TsciResult

async function persistComponentEvidence(
  projectDir: string,
  circuitJson: unknown,
  refdes: string,
  provenance: PackageProvenance,
): Promise<void> {
  let records: ComponentEvidenceRecord[] = []
  try {
    records = (await readComponentEvidence(projectDir)).records
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const record = createComponentEvidence(circuitJson, refdes, provenance)
  const retained = records.filter(
    (existing) =>
      existing.package.spec !== provenance.spec ||
      existing.package.version !== provenance.version ||
      existing.package.export !== provenance.export,
  )
  await writeComponentEvidence(projectDir, { schema: COMPONENT_EVIDENCE_SCHEMA, records: [...retained, record] })
}

function tsciCliCommand(args: string[]): string[] {
  const engine = resolveTsci()
  return engine ? [...engineCommand(engine), ...args] : ["npx", "--yes", "tsci", ...args]
}

function dependencyIncludesVersion(value: string | undefined, version: string): boolean {
  return value === version || value === `^${version}` || value === `~${version}`
}

async function readOptionalFile(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function restoreOptionalFile(filePath: string, content: Buffer | null): Promise<void> {
  if (content === null) await rm(filePath, { force: true })
  else await writeFile(filePath, content)
}

async function pinInstalledCandidate(projectDir: string, candidate: ComponentCandidate): Promise<void> {
  const installedManifestPath = path.join(projectDir, "node_modules", ...candidate.packageSpec.split("/"), "package.json")
  const installedManifest = JSON.parse(await readFile(installedManifestPath, "utf8")) as { version?: string }
  if (installedManifest.version !== candidate.version) {
    throw new Error(`Registry installed ${candidate.packageSpec}@${String(installedManifest.version)}; expected ${candidate.version}`)
  }

  const manifestPath = path.join(projectDir, "package.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { dependencies?: Record<string, string> }
  manifest.dependencies ??= {}
  manifest.dependencies[candidate.packageSpec] = candidate.version
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const packageLockPath = path.join(projectDir, "package-lock.json")
  const packageLockContent = await readOptionalFile(packageLockPath)
  if (packageLockContent) {
    const packageLock = JSON.parse(packageLockContent.toString("utf8")) as {
      packages?: Record<string, { dependencies?: Record<string, string> }>
    }
    const root = packageLock.packages?.[""]
    if (root?.dependencies?.[candidate.packageSpec]) root.dependencies[candidate.packageSpec] = candidate.version
    await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`)
  }

  const bunLockPath = path.join(projectDir, "bun.lock")
  const bunLockContent = await readOptionalFile(bunLockPath)
  if (bunLockContent) {
    const source = bunLockContent.toString("utf8")
    const range = JSON.stringify(`^${candidate.version}`)
    await writeFile(
      bunLockPath,
      source.replace(
        `${JSON.stringify(candidate.packageSpec)}: ${range}`,
        `${JSON.stringify(candidate.packageSpec)}: ${JSON.stringify(candidate.version)}`,
      ),
    )
  }
}

async function smokeTestComponent(projectDir: string, candidate: ComponentCandidate, signal?: AbortSignal): Promise<ComponentSmokeResult> {
  const id = `pcb-component-smoke-${randomUUID()}`
  const sourcePath = path.join(projectDir, "src", `${id}.tsx`)
  const outputDir = path.join(projectDir, "dist", "src", id)
  const source = `import React from "react"\nimport "tscircuit"\n${candidate.importStatement}\n\nexport default () => (\n  <board width="100mm" height="100mm">\n    <${candidate.exportName} name="U_TEST" />\n  </board>\n)\n`
  try {
    await writeFile(sourcePath, source)
    const result = await run(["build", `src/${id}.tsx`], projectDir, signal)
    if (!result.success) return result
    try {
      const json = await readCircuitJson(projectDir, path.join(outputDir, "circuit.json"))
      const inspection = inspectCircuitJson(json)
      if (inspection.designValid) {
        await persistComponentEvidence(projectDir, json, "U_TEST", {
          spec: candidate.packageSpec,
          version: candidate.version,
          export: candidate.exportName,
        })
        return result
      }
      return {
        ...result,
        success: false,
        exitCode: 1,
        stderr: [result.stderr, ...inspection.errors.flatMap((group) => group.messages)].filter(Boolean).join("\n"),
      }
    } catch (error) {
      return {
        ...result,
        success: false,
        exitCode: 1,
        stderr: [result.stderr, `Smoke build produced no readable Circuit JSON: ${error instanceof Error ? error.message : String(error)}`]
          .filter(Boolean)
          .join("\n"),
      }
    }
  } finally {
    await Promise.all([rm(sourcePath, { force: true }), rm(outputDir, { recursive: true, force: true })])
  }
}

export async function smokeTestImportedComponent(
  input: {
    projectDir: string
    relativePath: string
    lcscPartNumber: string
    exportName: string
    sha256: string
  },
  signal?: AbortSignal,
): Promise<TsciResult> {
  const id = `pcb-component-smoke-${randomUUID()}`
  const sourcePath = path.join(input.projectDir, "src", `${id}.tsx`)
  const outputDir = path.join(input.projectDir, "dist", "src", id)
  const modulePath = `../${input.relativePath.replace(/\.tsx$/i, "")}`
  const source = `import React from "react"\nimport "tscircuit"\nimport { ${input.exportName} } from ${JSON.stringify(modulePath)}\n\nexport default () => (\n  <board width="100mm" height="100mm">\n    <${input.exportName} name="U_TEST" />\n  </board>\n)\n`
  try {
    await writeFile(sourcePath, source)
    const result = await run(["build", `src/${id}.tsx`], input.projectDir, signal)
    if (!result.success) return result
    const json = await readCircuitJson(input.projectDir, path.join(outputDir, "circuit.json"))
    const inspection = inspectCircuitJson(json)
    if (!inspection.designValid) {
      return {
        ...result,
        success: false,
        exitCode: 1,
        stderr: [result.stderr, ...inspection.errors.flatMap((group) => group.messages)].filter(Boolean).join("\n"),
      }
    }
    await persistComponentEvidence(input.projectDir, json, "U_TEST", {
      spec: `lcsc:${input.lcscPartNumber}`,
      version: input.sha256,
      export: input.exportName,
    })
    return result
  } catch (error) {
    return { success: false, stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: 1 }
  } finally {
    await Promise.all([rm(sourcePath, { force: true }), rm(outputDir, { recursive: true, force: true })])
  }
}

export async function addComponentCandidate(
  projectDir: string,
  candidateId: string,
  signal?: AbortSignal,
  operations: ComponentAddOperations = {},
): Promise<ComponentAddResult> {
  const candidate = componentCandidates.get(candidateId)
  if (!candidate) {
    return {
      success: false,
      candidateId,
      packageName: null,
      packageSpec: null,
      version: null,
      verified: false,
      rolledBack: false,
      importStatement: null,
      exampleUsage: null,
      reason: "unknown_candidate",
      stdout: "",
      stderr: "Run pcb_component_search and use a candidateId from that response.",
    }
  }

  const verificationKey = candidateVerificationKey(candidateId, projectDir)
  const manifestPath = path.join(projectDir, "package.json")
  const lockPath = path.join(projectDir, "package-lock.json")
  const bunLockPath = path.join(projectDir, "bun.lock")
  const [manifest, lock, bunLock] = await Promise.all([
    readOptionalFile(manifestPath),
    readOptionalFile(lockPath),
    readOptionalFile(bunLockPath),
  ])
  if (!manifest) throw new Error(`PCB project has no package.json: ${projectDir}`)
  const manifestJson = JSON.parse(manifest.toString("utf8")) as { dependencies?: Record<string, string> }
  const verification = componentCandidateVerifications.get(verificationKey)
  if (
    verification?.status === "verified" &&
    dependencyIncludesVersion(manifestJson.dependencies?.[candidate.packageSpec], candidate.version)
  ) {
    return {
      success: true,
      candidateId,
      packageName: candidate.packageName,
      packageSpec: candidate.packageSpec,
      version: candidate.version,
      verified: true,
      rolledBack: false,
      importStatement: candidate.importStatement,
      exampleUsage: `<${candidate.exportName} name="U1" />`,
      reason: "already_verified",
      stdout: "",
      stderr: "",
    }
  }

  const install = operations.install ?? runCommand
  const installCommand = tsciCliCommand(["add", candidate.packageName])
  const installed = await serializeNpmExec(() => install(installCommand, projectDir, signal))
  let pinFailure: TsciResult | null = null
  if (installed.success) {
    try {
      await pinInstalledCandidate(projectDir, candidate)
    } catch (error) {
      pinFailure = {
        success: false,
        stdout: installed.stdout,
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }
    }
  }
  let smokeResult: ComponentSmokeResult | null = null
  if (installed.success && !pinFailure) smokeResult = await (operations.smoke ?? smokeTestComponent)(projectDir, candidate, signal)
  const failure = !installed.success ? installed : pinFailure ? pinFailure : smokeResult?.success ? null : smokeResult

  if (failure) {
    await Promise.all([
      restoreOptionalFile(manifestPath, manifest),
      restoreOptionalFile(lockPath, lock),
      restoreOptionalFile(bunLockPath, bunLock),
    ])
    await serializeNpmExec(() => install(["npm", "install", "--no-audit", "--no-fund", "--loglevel=error"], projectDir, signal)).catch(
      () => {},
    )
    const reason = !installed.success ? "install_failed" : pinFailure ? "version_verification_failed" : "smoke_test_failed"
    componentCandidateVerifications.set(verificationKey, { status: "rejected", reason })
    return {
      success: false,
      candidateId,
      packageName: candidate.packageName,
      packageSpec: candidate.packageSpec,
      version: candidate.version,
      verified: false,
      rolledBack: true,
      importStatement: candidate.importStatement,
      exampleUsage: null,
      reason,
      stdout: failure.stdout.slice(0, 8000),
      stderr: failure.stderr.slice(0, 4000),
    }
  }

  componentCandidateVerifications.set(verificationKey, { status: "verified", reason: "project_smoke_test_passed" })
  return {
    success: true,
    candidateId,
    packageName: candidate.packageName,
    packageSpec: candidate.packageSpec,
    version: candidate.version,
    verified: true,
    rolledBack: false,
    importStatement: candidate.importStatement,
    exampleUsage: `<${candidate.exportName} name="U1" />`,
    reason: "installed_and_verified",
    stdout: installed.stdout.slice(0, 8000),
    stderr: installed.stderr.slice(0, 4000),
  }
}

/**
 * Run `tsci build src/circuit.tsx` in the project directory.
 * Produces dist/src/circuit/circuit.json.
 */
async function finalizeBuild(result: TsciResult, projectDir: string, inputDigest: string): Promise<CircuitBuildResult> {
  const emptyArtifacts: BuildArtifacts = {
    circuitJsonPath: null,
    schematicSvgPath: null,
    pcbSvgPath: null,
    gerbersZipPath: null,
  }
  if (!result.success) return { ...result, processSuccess: false, artifacts: emptyArtifacts, inspection: null }

  const circuitJsonPath = path.join(projectDir, "dist", "src", "circuit", "circuit.json")
  try {
    const circuitJson = await readCircuitJson(projectDir, circuitJsonPath)
    const inspection = inspectCircuitJson(circuitJson)
    if ((await buildInputDigest(projectDir)) !== inputDigest) {
      throw new Error("Project inputs changed while the build was running. Run pcb_circuit_build again.")
    }
    const circuitJsonSha256 = createHash("sha256")
      .update(await readFile(circuitJsonPath))
      .digest("hex")
    await writeBuildInputStamp(projectDir, inputDigest, circuitJsonSha256)
    return {
      ...result,
      success: inspection.designValid,
      processSuccess: true,
      artifacts: { ...emptyArtifacts, circuitJsonPath },
      inspection,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...result,
      success: false,
      processSuccess: true,
      stderr: [result.stderr, `Unable to inspect generated Circuit JSON: ${message}`].filter(Boolean).join("\n"),
      artifacts: emptyArtifacts,
      inspection: null,
    }
  }
}

export async function buildCircuit(projectDir: string, signal?: AbortSignal): Promise<CircuitBuildResult> {
  await clearGeneratedArtifacts(projectDir)
  const inputDigest = await buildInputDigest(projectDir)
  const result = await run(["build", "src/circuit.tsx"], projectDir, signal)
  return finalizeBuild(result, projectDir, inputDigest)
}

/**
 * Run `tsci export` to produce SVG or Gerber outputs.
 * Supported formats: "schematic" | "pcb" | "gerber"
 */
export async function exportCircuit(
  projectDir: string,
  formats: Array<"schematic" | "pcb" | "gerber">,
  signal?: AbortSignal,
): Promise<CircuitExportResult> {
  // tsci exports one format at a time from the built Circuit JSON.
  let lastResult: TsciResult = { success: true, stdout: "", stderr: "", exitCode: 0 }
  const absoluteCircuitJsonPath = path.join(projectDir, "dist", "src", "circuit", "circuit.json")
  await assertFreshCircuitJson(projectDir, absoluteCircuitJsonPath)
  const circuitJson = await readCircuitJson(projectDir, absoluteCircuitJsonPath)
  const inspection = inspectCircuitJson(circuitJson)
  if (!(await circuitJsonUntampered(projectDir, absoluteCircuitJsonPath))) {
    return {
      success: false,
      stdout: "",
      stderr: tamperedArtifactMessage(),
      exitCode: 1,
      processSuccess: true,
      artifactGenerationSucceeded: false,
      designValid: inspection.designValid,
      debugOnly: false,
      generatedFormats: [],
      blockedFormats: formats.includes("gerber") ? ["gerber"] : [],
      manufacturingBlockers: [
        {
          type: "invalid_design",
          count: 1,
          messages: [tamperedArtifactMessage()],
          issues: [{ message: tamperedArtifactMessage() }],
        },
      ],
      artifacts: {
        circuitJsonPath: absoluteCircuitJsonPath,
        schematicSvgPath: null,
        pcbSvgPath: null,
        gerbersZipPath: null,
      },
      inspection,
    }
  }
  const blockers = manufacturingBlockers(circuitJson, undefined, { noConnect: await loadNoConnectIntents(projectDir) })
  const artifacts: BuildArtifacts = {
    circuitJsonPath: absoluteCircuitJsonPath,
    schematicSvgPath: null,
    pcbSvgPath: null,
    gerbersZipPath: null,
  }
  const circuitJsonPath = path.relative(projectDir, absoluteCircuitJsonPath)
  const blockedFormats: Array<"gerber"> = blockers.length > 0 && formats.includes("gerber") ? ["gerber"] : []
  if (blockers.length > 0) await rm(path.join(projectDir, "dist", "circuit-gerbers.zip"), { force: true })
  const formatsToGenerate = formats.filter((format) => !blockedFormats.includes(format as "gerber"))
  const generatedFormats: Array<"schematic" | "pcb" | "gerber"> = []

  const exportResults = await Promise.all(
    formatsToGenerate.map(async (format) => {
      const args =
        format === "gerber"
          ? ["export", circuitJsonPath, "--format", "gerbers", "--output", "../../circuit-gerbers.zip"]
          : ["export", circuitJsonPath, "--format", `${format}-svg`, "--output", `../../${format}.svg`]
      const result = await run(args, projectDir, signal)
      return { format, result }
    }),
  )
  for (const { format, result } of exportResults) {
    lastResult = {
      success: lastResult.success && result.success,
      stdout: [lastResult.stdout, result.stdout].filter(Boolean).join("\n"),
      stderr: [lastResult.stderr, result.stderr].filter(Boolean).join("\n"),
      exitCode: result.exitCode !== 0 ? result.exitCode : lastResult.exitCode,
    }
    if (result.success) {
      generatedFormats.push(format)
      if (format === "schematic") artifacts.schematicSvgPath = path.join(projectDir, "dist", "schematic.svg")
      if (format === "pcb") artifacts.pcbSvgPath = path.join(projectDir, "dist", "pcb.svg")
      if (format === "gerber") artifacts.gerbersZipPath = path.join(projectDir, "dist", "circuit-gerbers.zip")
    }
  }

  const processSuccess = lastResult.success
  const artifactGenerationSucceeded = processSuccess && blockedFormats.length === 0 && generatedFormats.length === formats.length
  return {
    ...lastResult,
    success: artifactGenerationSucceeded && inspection.designValid,
    processSuccess,
    artifactGenerationSucceeded,
    designValid: inspection.designValid,
    debugOnly: false,
    generatedFormats,
    blockedFormats: [...blockedFormats],
    manufacturingBlockers: blockers,
    artifacts,
    inspection,
  }
}

export type RunProjectBuildOptions = {
  signal?: AbortSignal
  /** Override npm resolution (tests). `null` forces bundled tsci fallback. */
  npmPath?: string | null
}

/**
 * Run the project's `npm run build:source` script (which wraps tsci build + verify).
 * Falls back to bundled tsci when npm is missing, spawn fails with ENOENT, or the script is undefined.
 */
export async function runProjectBuild(
  projectDir: string,
  signalOrOptions?: AbortSignal | RunProjectBuildOptions,
): Promise<CircuitBuildResult> {
  const options: RunProjectBuildOptions =
    signalOrOptions instanceof AbortSignal || signalOrOptions === undefined ? { signal: signalOrOptions } : signalOrOptions
  const signal = options.signal
  await clearGeneratedArtifacts(projectDir)
  const inputDigest = await buildInputDigest(projectDir)
  const npmPath = options.npmPath !== undefined ? options.npmPath : Bun.which("npm")
  if (!npmPath) {
    return buildCircuit(projectDir, signal)
  }

  try {
    const npmProc = Bun.spawn([npmPath, "run", "--silent", "build:source"], {
      cwd: projectDir,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
      signal,
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(npmProc.stdout).text(),
      new Response(npmProc.stderr).text(),
      npmProc.exited,
    ])

    if (exitCode !== 0 && (stderr.includes("Missing script") || /ENOENT|not found|No such file/i.test(`${stderr}\n${stdout}`))) {
      return buildCircuit(projectDir, signal)
    }

    return finalizeBuild({ success: exitCode === 0, stdout, stderr, exitCode }, projectDir, inputDigest)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ENOENT|not found|No such file/i.test(message)) {
      return buildCircuit(projectDir, signal)
    }
    throw error
  }
}
