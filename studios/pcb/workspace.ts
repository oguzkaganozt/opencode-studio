import type { Dirent } from "node:fs"
import { lstat, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"
import { artifactFreshness, staleArtifactMessage } from "./artifact-freshness"
import { type CircuitInspection, inspectCircuitJson, readCircuitJson } from "./circuit-json"
import { circuitReadiness } from "./readiness"

export type CircuitProject = {
  id: string
  name: string
  relativePath: string
  absolutePath: string
  circuitSource: string
  hasCircuitJson: boolean
  hasSchematicSvg: boolean
  hasPcbSvg: boolean
  hasGerbersZip: boolean
  circuitJsonPath: string | null
  schematicSvgPath: string | null
  pcbSvgPath: string | null
  gerbersZipPath: string | null
  inspection: CircuitInspection | null
  fabricationReady: boolean | null
  assemblyReady: boolean | null
  artifactStatus: "missing" | "fresh" | "stale"
  artifactError: string | null
}

export type CircuitProjectDescriptor = Pick<CircuitProject, "id" | "name" | "relativePath" | "absolutePath" | "circuitSource">

const SKIP_DIRS = new Set(["node_modules", ".venv", ".git", "dist", "__pycache__", ".pytest_cache", "catalog"])

export async function discoverProjects(workspaceRoot: string): Promise<CircuitProject[]> {
  return loadProjects(await discoverProjectDescriptors(workspaceRoot))
}

export async function discoverProjectDescriptors(workspaceRoot: string): Promise<CircuitProjectDescriptor[]> {
  const root = path.resolve(workspaceRoot)
  const projects: CircuitProjectDescriptor[] = []
  await walkDir(root, root, projects, 0)
  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

async function walkDir(workspaceRoot: string, dir: string, projects: CircuitProjectDescriptor[], depth: number) {
  if (depth > 6) return
  if (!isInside(workspaceRoot, dir) && path.resolve(dir) !== path.resolve(workspaceRoot)) return

  const base = path.basename(dir)
  if (base.startsWith(".") || SKIP_DIRS.has(base)) return

  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  const circuitSource = path.join(dir, "src", "circuit.tsx")
  if (await regularFileExists(circuitSource)) {
    const project = await describeProjectAt(workspaceRoot, dir)
    if (project) projects.push(project)
    return
  }

  const children = entries.filter((entry) => !entry.isSymbolicLink() && entry.isDirectory()).map((entry) => path.join(dir, entry.name))
  for (const child of children) {
    if (child) await walkDir(workspaceRoot, child, projects, depth + 1)
  }
}

async function describeProjectAt(workspaceRoot: string, dir: string): Promise<CircuitProjectDescriptor | null> {
  let canonicalDir: string
  try {
    canonicalDir = await realpath(dir)
  } catch {
    return null
  }
  if (!isInside(workspaceRoot, canonicalDir) && canonicalDir !== path.resolve(workspaceRoot)) return null

  const relativePath = path.relative(workspaceRoot, canonicalDir) || "."
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null

  return {
    id: encodeProjectId(relativePath),
    name: path.basename(canonicalDir),
    relativePath,
    absolutePath: canonicalDir,
    circuitSource: path.join(canonicalDir, "src", "circuit.tsx"),
  }
}

async function loadProject(descriptor: CircuitProjectDescriptor): Promise<CircuitProject> {
  const canonicalDir = descriptor.absolutePath

  const circuitJsonPath = path.join(canonicalDir, "dist", "src", "circuit", "circuit.json")
  const schematicSvgPath = path.join(canonicalDir, "dist", "schematic.svg")
  const pcbSvgPath = path.join(canonicalDir, "dist", "pcb.svg")
  const gerbersZipPath = path.join(canonicalDir, "dist", "circuit-gerbers.zip")

  const [rawCircuitJson, rawSchematicSvg, rawPcbSvg, rawGerbersZip] = await Promise.all([
    regularFileExists(circuitJsonPath),
    regularFileExists(schematicSvgPath),
    regularFileExists(pcbSvgPath),
    regularFileExists(gerbersZipPath),
  ])
  const hasArtifacts = rawCircuitJson || rawSchematicSvg || rawPcbSvg || rawGerbersZip
  const freshness = hasArtifacts ? await artifactFreshness(canonicalDir) : null
  const artifactsFresh = freshness?.fresh === true
  const hasCircuitJson = artifactsFresh && rawCircuitJson
  const hasSchematicSvg = artifactsFresh && rawSchematicSvg
  const hasPcbSvg = artifactsFresh && rawPcbSvg
  const hasGerbersZip = artifactsFresh && rawGerbersZip
  let inspection: CircuitInspection | null = null
  let fabricationReady: boolean | null = null
  let assemblyReady: boolean | null = null
  if (hasCircuitJson) {
    try {
      const circuit = await readCircuitJson(canonicalDir, circuitJsonPath)
      inspection = inspectCircuitJson(circuit)
      const readiness = circuitReadiness(circuit, { inspection })
      fabricationReady = readiness.fabricationReady
      assemblyReady = readiness.assemblyReady
    } catch {
      // Keep malformed or transient build artifacts distinguishable from valid designs.
    }
  }

  return {
    ...descriptor,
    hasCircuitJson,
    hasSchematicSvg,
    hasPcbSvg,
    hasGerbersZip,
    circuitJsonPath: hasCircuitJson ? circuitJsonPath : null,
    schematicSvgPath: hasSchematicSvg ? schematicSvgPath : null,
    pcbSvgPath: hasPcbSvg ? pcbSvgPath : null,
    gerbersZipPath: hasGerbersZip ? gerbersZipPath : null,
    inspection,
    fabricationReady,
    assemblyReady,
    artifactStatus: !hasArtifacts ? "missing" : artifactsFresh ? "fresh" : "stale",
    artifactError: freshness && !freshness.fresh ? staleArtifactMessage(freshness.reason) : null,
  }
}

export async function loadProjects(descriptors: CircuitProjectDescriptor[]): Promise<CircuitProject[]> {
  return Promise.all(descriptors.map((descriptor) => loadProject(descriptor)))
}

async function regularFileExists(filePath: string): Promise<boolean> {
  try {
    const info = await lstat(filePath)
    return info.isFile() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

export function encodeProjectId(relativePath: string): string {
  return Buffer.from(relativePath).toString("base64url")
}

export function decodeProjectId(id: string): string {
  if (!/^[A-Za-z0-9_=-]+$/.test(id)) throw new Error("Invalid project ID")
  return Buffer.from(id, "base64url").toString("utf8")
}

export async function resolveProject(workspaceRoot: string, id: string): Promise<CircuitProject> {
  const relativePath = decodeProjectId(id)
  if (relativePath.includes("\0") || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes("..")) {
    throw new Error(`Project not found: ${relativePath}`)
  }
  const root = path.resolve(workspaceRoot)
  const absolutePath = relativePath === "." ? root : path.resolve(root, relativePath)
  if (!isInside(root, absolutePath) && absolutePath !== root) throw new Error(`Project not found: ${relativePath}`)
  if (!(await regularFileExists(path.join(absolutePath, "src", "circuit.tsx")))) {
    throw new Error(`Project not found: ${relativePath}`)
  }
  const descriptor = await describeProjectAt(root, absolutePath)
  if (!descriptor) throw new Error(`Project not found: ${relativePath}`)
  return loadProject(descriptor)
}

export function projectSummary(p: CircuitProject) {
  return {
    id: p.id,
    name: p.name,
    path: p.relativePath,
    directory: p.absolutePath,
    built: p.hasCircuitJson,
    artifactStatus: p.artifactStatus,
    artifactError: p.artifactError,
    hasSchematicSvg: p.hasSchematicSvg,
    hasPcbSvg: p.hasPcbSvg,
    hasGerbersZip: p.hasGerbersZip,
    designValid: p.inspection?.designValid ?? null,
    fabricationReady: p.fabricationReady,
    assemblyReady: p.assemblyReady,
    errorCount: p.inspection?.errorCount ?? null,
    warningCount: p.inspection?.warningCount ?? null,
  }
}

export function projectDetail(p: CircuitProject) {
  return {
    ...projectSummary(p),
    diagnostics: p.inspection,
  }
}
