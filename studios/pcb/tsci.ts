import { mkdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  type CircuitInspection,
  inspectCircuitJson,
  type ManufacturingBlocker,
  manufacturingBlockers,
  readCircuitJson,
} from "./circuit-json"

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

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const SEARCH_TSCIRCUIT_VERSION = "0.0.2116"

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
}

async function assertFreshCircuitJson(projectDir: string, circuitJsonPath: string): Promise<void> {
  const sourcePath = path.join(projectDir, "src", "circuit.tsx")
  const [sourceInfo, circuitInfo] = await Promise.all([stat(sourcePath), stat(circuitJsonPath)])
  if (circuitInfo.mtimeMs < sourceInfo.mtimeMs) {
    throw new Error("Circuit JSON is older than src/circuit.tsx. Run pcb_circuit_build before exporting.")
  }
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
  // Prefer the project's local tsci binary; fall back to npx.
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
      return {
        source: "tscircuit",
        exactMatch: normalizedPartId(result.name.split("/").at(-1) ?? result.name) === normalizedPartId(parsedQuery),
        packageName: result.name,
        version: optionalString(result.latest_version),
        description: optionalString(result.ai_description) ?? optionalString(result.description),
        usageInstructions: optionalString(result.ai_usage_instructions),
        starCount: optionalNumber(result.star_count),
        hasPublicDist: (optionalBoolean(result.public_dist_enabled) ?? optionalBoolean(result.has_public_dist)) === true,
        loadability: classifyRegistryLoadability(result),
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
    return runCommand(
      ["npm", "exec", "--yes", `--package=tscircuit@${SEARCH_TSCIRCUIT_VERSION}`, "--", "tsci", "search", ...sourceArgs, "--json", query],
      searchCwd,
      signal,
    )
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

export async function searchComponents(
  query: string,
  scope: ComponentSearchScope = "all",
  signal?: AbortSignal,
): Promise<ComponentSearchResult> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) throw new Error("Component search query must not be empty")
  const searchCwd = path.join(os.tmpdir(), "opencode-studio-tsci-search")
  await mkdir(searchCwd, { recursive: true })

  const initial = await searchComponentsForScope(normalizedQuery, scope, searchCwd, signal)
  const fallbackQuery = initial.success && initial.results.length === 0 ? componentSearchFallbackQuery(normalizedQuery) : null
  if (!fallbackQuery) return initial

  const fallback = await searchComponentsForScope(fallbackQuery, scope, searchCwd, signal)
  const attemptedQueries = [normalizedQuery, fallbackQuery]
  if (!fallback.success) {
    return {
      ...initial,
      attemptedQueries,
      stderr: [initial.stderr, `Fallback search '${fallbackQuery}' failed: ${fallback.stderr}`].filter(Boolean).join("\n"),
    }
  }
  return { ...fallback, query: normalizedQuery, attemptedQueries, fallbackUsed: true }
}

/**
 * Run `tsci build src/circuit.tsx` in the project directory.
 * Produces dist/src/circuit/circuit.json.
 */
async function finalizeBuild(result: TsciResult, projectDir: string): Promise<CircuitBuildResult> {
  const emptyArtifacts: BuildArtifacts = {
    circuitJsonPath: null,
    schematicSvgPath: null,
    pcbSvgPath: null,
    gerbersZipPath: null,
  }
  if (!result.success) return { ...result, processSuccess: false, artifacts: emptyArtifacts, inspection: null }

  const circuitJsonPath = path.join(projectDir, "dist", "src", "circuit", "circuit.json")
  try {
    const inspection = inspectCircuitJson(await readCircuitJson(projectDir, circuitJsonPath))
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
  const result = await run(["build", "src/circuit.tsx"], projectDir, signal)
  return finalizeBuild(result, projectDir)
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
  const blockers = manufacturingBlockers(circuitJson)
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

  for (const format of formatsToGenerate) {
    const args =
      format === "gerber"
        ? ["export", circuitJsonPath, "--format", "gerbers", "--output", "../../circuit-gerbers.zip"]
        : ["export", circuitJsonPath, "--format", `${format}-svg`, "--output", `../../${format}.svg`]

    const result = await run(args, projectDir, signal)
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

/**
 * Run the project's `npm run build:source` script (which wraps tsci build + verify).
 * Falls back to a direct tsci build if the script is not defined.
 */
export async function runProjectBuild(projectDir: string, signal?: AbortSignal): Promise<CircuitBuildResult> {
  await clearGeneratedArtifacts(projectDir)
  // Try the npm script first (preferred — runs verify too)
  const npmProc = Bun.spawn(["npm", "run", "--silent", "build:source"], {
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

  // npm exits 1 when the script is missing; fall back to tsci directly
  if (exitCode !== 0 && stderr.includes("Missing script")) {
    return buildCircuit(projectDir, signal)
  }

  return finalizeBuild({ success: exitCode === 0, stdout, stderr, exitCode }, projectDir)
}
