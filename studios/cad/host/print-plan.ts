import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AcceptanceV1 } from "./acceptance"
import type { ArtifactManifest } from "./manifest"
import { buildRevision } from "./manifest"

export const PRINT_PLAN_FILE = "print-plan.json"

export type PrintPlanEntry = {
  artifactId: string
  bodyHash: string
  rotateDeg: [number, number, number]
  translateMm: [number, number, number]
  boundsMm: { min: [number, number, number]; max: [number, number, number] }
}

export type PrintPlanV1 = {
  schema: 1
  buildRevision: string
  entries: PrintPlanEntry[]
}

export class PrintPlanError extends Error {}

function finiteVector3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new PrintPlanError(`${label} must be an array of three finite numbers`)
  }
  return value as [number, number, number]
}

/**
 * Rotate a point per build123d `Location` Intrinsic.XYZ convention: apply
 * rotation about world Z, then world Y, then world X (degrees), then
 * translate. Must match `Location((tx,ty,tz),(rx,ry,rz))` in verify.ts.
 */
export function applyPose(
  point: [number, number, number],
  rotateDeg: [number, number, number],
  translateMm: [number, number, number],
): [number, number, number] {
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  let [x, y, z] = point

  const rz = rad(rotateDeg[2])
  if (rz !== 0) {
    const cos = Math.cos(rz)
    const sin = Math.sin(rz)
    ;[x, y] = [x * cos - y * sin, x * sin + y * cos]
  }
  const ry = rad(rotateDeg[1])
  if (ry !== 0) {
    const cos = Math.cos(ry)
    const sin = Math.sin(ry)
    ;[x, z] = [x * cos + z * sin, -x * sin + z * cos]
  }
  const rx = rad(rotateDeg[0])
  if (rx !== 0) {
    const cos = Math.cos(rx)
    const sin = Math.sin(rx)
    ;[y, z] = [y * cos - z * sin, y * sin + z * cos]
  }
  return [x + translateMm[0], y + translateMm[1], z + translateMm[2]]
}

/** Axis-aligned bounds of a rotated+translated box (from its bbox corners). */
export function posedBounds(
  bounds: { min: [number, number, number]; max: [number, number, number] },
  rotateDeg: [number, number, number],
  translateMm: [number, number, number],
): { min: [number, number, number]; max: [number, number, number] } {
  const corners: Array<[number, number, number]> = []
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        corners.push([x, y, z])
      }
    }
  }
  const posed = corners.map((corner) => applyPose(corner, rotateDeg, translateMm))
  const min: [number, number, number] = [
    Math.min(...posed.map((p) => p[0])),
    Math.min(...posed.map((p) => p[1])),
    Math.min(...posed.map((p) => p[2])),
  ]
  const max: [number, number, number] = [
    Math.max(...posed.map((p) => p[0])),
    Math.max(...posed.map((p) => p[1])),
    Math.max(...posed.map((p) => p[2])),
  ]
  return { min, max }
}

export async function readPrintPlan(designDir: string): Promise<PrintPlanV1 | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(designDir, PRINT_PLAN_FILE), "utf8")) as PrintPlanV1
    if (parsed.schema !== 1 || typeof parsed.buildRevision !== "string" || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

export async function writePrintPlan(designDir: string, plan: PrintPlanV1): Promise<void> {
  await writeFile(path.join(designDir, PRINT_PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`, "utf8")
}

/**
 * Build a print plan from agent poses. Host fills bodyHash and bounds, then
 * checks bed contact and build-volume fit. One entry per final artifact
 * (including mirrors) is required.
 */
export function buildPrintPlan(input: {
  id: string
  artifact: ArtifactManifest
  acceptance: AcceptanceV1
  entries: Array<{
    artifactId: string
    rotateDeg: [number, number, number]
    translateMm: [number, number, number]
  }>
}): PrintPlanV1 {
  const { artifact, acceptance } = input
  const artifactIds = new Set(artifact.parts.map((part) => part.id))
  const requested = new Set(input.entries.map((entry) => entry.artifactId))
  if (requested.size !== input.entries.length) throw new PrintPlanError("print plan entries must be unique")
  for (const artifactId of artifactIds) {
    if (!requested.has(artifactId)) throw new PrintPlanError(`Missing print plan entry for artifact ${artifactId}`)
  }
  for (const artifactId of requested) {
    if (!artifactIds.has(artifactId)) throw new PrintPlanError(`Print plan references unknown artifact ${artifactId}`)
  }

  const byId = new Map(artifact.parts.map((part) => [part.id, part]))
  const entries: PrintPlanEntry[] = input.entries.map((entry) => {
    const part = byId.get(entry.artifactId)
    if (!part) throw new PrintPlanError(`Unknown artifact ${entry.artifactId}`)
    const bounds = part.metrics.bounds_mm
    if (!bounds) throw new PrintPlanError(`Artifact ${entry.artifactId} has no bounds_mm`)
    const rotateDeg = finiteVector3(entry.rotateDeg, `entry ${entry.artifactId} rotateDeg`)
    const translateMm = finiteVector3(entry.translateMm, `entry ${entry.artifactId} translateMm`)
    const bodyHash = part.body_hash
    if (!bodyHash) throw new PrintPlanError(`Artifact ${entry.artifactId} has no body_hash; rebuild with the current engine`)
    const posed = posedBounds(bounds, rotateDeg, translateMm)
    const size = posed.max.map((max, index) => max - posed.min[index])
    const volume = acceptance.manufacturing.buildVolumeMm
    if (size.some((value, index) => value > volume[index]! + 0.01)) {
      throw new PrintPlanError(
        `Artifact ${entry.artifactId} posed size ${size.map((s) => s.toFixed(1)).join("x")} exceeds build volume ${volume.join("x")}`,
      )
    }
    const minZ = posed.min[2]
    const bedTolerance = acceptance.manufacturing.bedToleranceMm
    if (minZ < -bedTolerance || minZ > bedTolerance) {
      throw new PrintPlanError(`Artifact ${entry.artifactId} minZ ${minZ.toFixed(3)} mm is not on the bed (tolerance ${bedTolerance} mm)`)
    }
    return { artifactId: entry.artifactId, bodyHash, rotateDeg, translateMm, boundsMm: posed }
  })

  return { schema: 1, buildRevision: buildRevision(artifact), entries }
}
