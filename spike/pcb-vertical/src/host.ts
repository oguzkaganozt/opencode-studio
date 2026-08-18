import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export type Intent = {
  schema: 1
  state: "locked"
  contractHash: string
  required: string[]
}

export type Evidence = {
  id: string
  axis: "drc"
  contractHash: string
  sourceHash: string
  status: "pass" | "fail"
  findings: { severity: "error"; message: string }[]
}

export type QcReport = {
  complete: boolean
  contractHash: string
  sourceHash: string
  evidenceId: string
  blockers: string[]
}

export type ApplyResult = {
  changedPaths: string[]
  sourceHash: string
}

const applyLocks = new Map<string, Promise<void>>()

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

export function designDir(root: string, id: string): string {
  return path.join(root, "designs", id)
}

export function sourcePath(root: string, id: string): string {
  return path.join(designDir(root, id), "src", "circuit.tsx")
}

export async function lockIntent(root: string, id: string, required: string[]): Promise<Intent> {
  const dir = designDir(root, id)
  await mkdir(path.join(dir, "src"), { recursive: true })
  await mkdir(path.join(dir, "evidence", "records"), { recursive: true })
  await mkdir(path.join(dir, ".artifacts"), { recursive: true })
  const draft = { schema: 1 as const, state: "locked" as const, required }
  const contractHash = sha256(JSON.stringify(draft))
  const intent: Intent = { ...draft, contractHash }
  await writeFile(path.join(dir, "intent.json"), `${JSON.stringify(intent, null, 2)}\n`)
  await writeFile(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: id, private: true, type: "module", dependencies: { tscircuit: "0.0.2306" } }, null, 2)}\n`,
  )
  await writeFile(sourcePath(root, id), "")
  return intent
}

export async function readIntent(root: string, id: string): Promise<Intent> {
  return JSON.parse(await readFile(path.join(designDir(root, id), "intent.json"), "utf8")) as Intent
}

export async function readSource(root: string, id: string): Promise<string> {
  return readFile(sourcePath(root, id), "utf8")
}

export async function applySource(
  root: string,
  id: string,
  contents: string,
  baseHash: string,
): Promise<ApplyResult> {
  const target = sourcePath(root, id)
  const previous = applyLocks.get(target) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  applyLocks.set(target, previous.then(() => gate))
  await previous
  try {
    const current = await readSource(root, id)
    if (sha256(current) !== baseHash) {
      throw new Error("hash mismatch")
    }
    const tmp = `${target}.${randomUUID()}.tmp`
    await writeFile(tmp, contents)
    await rename(tmp, target)
    return { changedPaths: [path.resolve(target)], sourceHash: sha256(contents) }
  } finally {
    release()
    if (applyLocks.get(target) === gate) applyLocks.delete(target)
  }
}

export function coverageFindings(source: string, intent: Intent): Evidence["findings"] {
  return intent.required
    .filter((token) => !source.includes(token))
    .map((token) => ({ severity: "error" as const, message: `coverage: missing ${token}` }))
}

export async function writeEvidence(root: string, id: string, evidence: Evidence): Promise<void> {
  const file = path.join(designDir(root, id), "evidence", "records", `${evidence.id}.json`)
  await writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`)
}

export async function qcReport(
  root: string,
  id: string,
  worker: { status: "pass" | "fail"; findings: Evidence["findings"] },
): Promise<QcReport> {
  const intent = await readIntent(root, id)
  const source = await readSource(root, id)
  const sourceHash = sha256(source)
  const findings = [...coverageFindings(source, intent), ...worker.findings]
  const status = findings.length === 0 && worker.status === "pass" ? "pass" : "fail"
  const evidence: Evidence = {
    id: randomUUID(),
    axis: "drc",
    contractHash: intent.contractHash,
    sourceHash,
    status,
    findings,
  }
  await writeEvidence(root, id, evidence)
  const report: QcReport = {
    complete: status === "pass",
    contractHash: intent.contractHash,
    sourceHash,
    evidenceId: evidence.id,
    blockers: findings.map((item) => item.message),
  }
  await writeFile(path.join(designDir(root, id), "qc-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export async function startGeneration(root: string, id: string): Promise<string> {
  const generation = randomUUID()
  await mkdir(path.join(designDir(root, id), ".artifacts", generation), { recursive: true })
  return generation
}

export async function stageArtifact(root: string, id: string, generation: string, body: string): Promise<void> {
  await writeFile(path.join(designDir(root, id), ".artifacts", generation, "gerber.txt"), body)
}

export async function publish(root: string, id: string, generation: string): Promise<void> {
  const report = JSON.parse(await readFile(path.join(designDir(root, id), "qc-report.json"), "utf8")) as QcReport
  if (!report.complete) {
    throw new Error("refusing to publish incomplete QC")
  }
  const current = path.join(designDir(root, id), "current")
  await rm(current, { recursive: true, force: true })
  await mkdir(current, { recursive: true })
  const staged = await readFile(path.join(designDir(root, id), ".artifacts", generation, "gerber.txt"), "utf8")
  await writeFile(path.join(current, "gerber.txt"), staged)
  await writeFile(path.join(current, "generation"), `${generation}\n`)
}

export async function abortGeneration(root: string, id: string, generation: string): Promise<void> {
  await rm(path.join(designDir(root, id), ".artifacts", generation), { recursive: true, force: true })
}

export async function currentGeneration(root: string, id: string): Promise<string | null> {
  try {
    return (await readFile(path.join(designDir(root, id), "current", "generation"), "utf8")).trim()
  } catch {
    return null
  }
}

export function failSource(): string {
  return [
    'import React from "react"',
    'import "tscircuit"',
    "",
    "export default () => (",
    '  <board width="10mm" height="8mm">',
    '    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} schX={-2} schY={0} />',
    '    <resistor name="R2" resistance="1k" footprint="0603" pcbX={0} pcbY={0} schX={2} schY={0} />',
    "  </board>",
    ")",
    "",
  ].join("\n")
}

export function passSource(): string {
  return [
    'import React from "react"',
    'import "tscircuit"',
    "",
    "export default () => (",
    '  <board width="20mm" height="15mm">',
    '    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} schX={-2} schY={0} />',
    '    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={5} pcbY={0} schX={2} schY={0} />',
    '    <trace from=".R1 > .pin2" to=".C1 > .pin1" />',
    "  </board>",
    ")",
    "",
  ].join("\n")
}
