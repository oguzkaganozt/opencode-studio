import { lstat, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"
import { generateBom } from "./bom"
import { type CircuitInspection, inspectCircuitJson, manufacturingBlockers, readCircuitJson } from "./circuit-json"

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
}

const SKIP_DIRS = new Set(["node_modules", ".venv", ".git", "dist", "__pycache__", ".pytest_cache"])

export async function discoverProjects(workspaceRoot: string): Promise<CircuitProject[]> {
  const root = path.resolve(workspaceRoot)
  const projects: CircuitProject[] = []
  await walkDir(root, root, projects, 0)
  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

async function walkDir(workspaceRoot: string, dir: string, projects: CircuitProject[], depth: number) {
  if (depth > 6) return
  if (!isInside(workspaceRoot, dir) && path.resolve(dir) !== path.resolve(workspaceRoot)) return

  const base = path.basename(dir)
  if (base.startsWith(".") || SKIP_DIRS.has(base)) return

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  // A directory is a circuit project if it has src/circuit.tsx
  const circuitSource = path.join(dir, "src", "circuit.tsx")
  if (await regularFileExists(circuitSource)) {
    let canonicalDir: string
    try {
      canonicalDir = await realpath(dir)
    } catch {
      return
    }
    if (!isInside(workspaceRoot, canonicalDir) && canonicalDir !== path.resolve(workspaceRoot)) return

    const relativePath = path.relative(workspaceRoot, canonicalDir) || "."
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return

    const circuitJsonPath = path.join(canonicalDir, "dist", "src", "circuit", "circuit.json")
    const schematicSvgPath = path.join(canonicalDir, "dist", "schematic.svg")
    const pcbSvgPath = path.join(canonicalDir, "dist", "pcb.svg")
    const gerbersZipPath = path.join(canonicalDir, "dist", "circuit-gerbers.zip")

    const [hasCircuitJson, hasSchematicSvg, hasPcbSvg, hasGerbersZip] = await Promise.all([
      regularFileExists(circuitJsonPath),
      regularFileExists(schematicSvgPath),
      regularFileExists(pcbSvgPath),
      regularFileExists(gerbersZipPath),
    ])
    let inspection: CircuitInspection | null = null
    let fabricationReady: boolean | null = null
    let assemblyReady: boolean | null = null
    if (hasCircuitJson) {
      try {
        const circuit = await readCircuitJson(workspaceRoot, circuitJsonPath)
        inspection = inspectCircuitJson(circuit)
        fabricationReady = manufacturingBlockers(circuit).length === 0
        assemblyReady = fabricationReady && generateBom(circuit).bomComplete
      } catch {
        // Keep malformed or transient build artifacts distinguishable from valid designs.
      }
    }

    projects.push({
      id: encodeProjectId(relativePath),
      name: path.basename(canonicalDir),
      relativePath,
      absolutePath: canonicalDir,
      circuitSource: path.join(canonicalDir, "src", "circuit.tsx"),
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
    })
    return // Don't recurse into a project directory
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry)
    try {
      const info = await lstat(entryPath)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await walkDir(workspaceRoot, entryPath, projects, depth + 1)
    } catch {
      // skip unreadable entries
    }
  }
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
  const projects = await discoverProjects(workspaceRoot)
  const project = projects.find((p) => p.relativePath === relativePath)
  if (!project) throw new Error(`Project not found: ${relativePath}`)
  return project
}

export function projectSummary(p: CircuitProject) {
  return {
    id: p.id,
    name: p.name,
    path: p.relativePath,
    built: p.hasCircuitJson,
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
