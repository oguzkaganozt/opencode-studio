import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { STUDIO_IDS } from "../src/core/registry"

export const BENCH_STUDIOS = ["cad", "pcb", "fw"] as const
export type BenchStudio = (typeof BENCH_STUDIOS)[number]

export type BenchCase = {
  studio: BenchStudio
  id: string
  agent: string
  model: string
  files: string[]
  prompt: string
  source: string
  expect?: string
  requires: string[]
}

export type BenchEvent = {
  type?: string
  timestamp?: number
  part?: { type?: string; tool?: string; state?: { output?: unknown; input?: unknown }; tokens?: Record<string, number>; text?: string }
}

const DEFAULT_MODEL = "xai/grok-4.5"

export function isBenchStudio(value: string): value is BenchStudio {
  return (BENCH_STUDIOS as readonly string[]).includes(value)
}

export function repoRoot() {
  return path.resolve(import.meta.dir, "..")
}

export function casesDir(studio: BenchStudio, root = repoRoot()) {
  return path.join(root, "studios", studio, "test", "benchmarks")
}

export function extractPrompt(markdown: string) {
  const match = markdown.match(/```text\n([\s\S]*?)\n```/)
  if (!match?.[1]?.trim()) throw new Error("Benchmark markdown is missing a ```text prompt block")
  return match[1].replace(/\n$/, "")
}

function meta(markdown: string, key: string) {
  const match = markdown.match(new RegExp(`\\*\\*${key}:\\*\\*\\s+\`?([^\\n\`]+)\`?`))
  return match?.[1]?.trim()
}

export function parseBenchCase(studio: BenchStudio, source: string, markdown: string, root = repoRoot()): BenchCase {
  const id = meta(markdown, "id") ?? path.basename(source, ".md")
  const agent = meta(markdown, "agent") ?? `studio-${studio}`
  const modelField = meta(markdown, "model / flavor") ?? meta(markdown, "model") ?? DEFAULT_MODEL
  const model = modelField.split(/\s+/)[0] ?? DEFAULT_MODEL
  const image = meta(markdown, "reference image")
  const files = image ? [path.resolve(root, image.split(/\s+/)[0] ?? image)] : []
  const expect = meta(markdown, "expect")
  const requires = (meta(markdown, "requires") ?? "").split(/[,\s]+/).filter(Boolean)
  return { studio, id, agent, model, files, prompt: extractPrompt(markdown), source, expect, requires }
}

export async function listBenchCases(studio: BenchStudio, root = repoRoot()): Promise<BenchCase[]> {
  const dir = casesDir(studio, root)
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort()
  const cases: BenchCase[] = []
  for (const name of names) {
    const source = path.join(dir, name)
    cases.push(parseBenchCase(studio, source, await readFile(source, "utf8"), root))
  }
  return cases
}

export async function loadBenchCase(studio: BenchStudio, id: string, root = repoRoot()) {
  const cases = await listBenchCases(studio, root)
  const found = cases.find((item) => item.id === id)
  if (!found) throw new Error(`Unknown ${studio} benchmark '${id}'. Available: ${cases.map((item) => item.id).join(", ") || "(none)"}`)
  return found
}

export function loadEvents(text: string): BenchEvent[] {
  const events: BenchEvent[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as BenchEvent)
    } catch {
      // ignore non-JSON
    }
  }
  return events
}

function toolName(event: BenchEvent) {
  if (event.type === "tool_use" || event.part?.type === "tool") return event.part?.tool ?? "?"
  return null
}

function toolOutput(event: BenchEvent | undefined) {
  const raw = event?.part?.state?.output
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { text: raw }
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>
  return {}
}

export function summarizeEvents(events: BenchEvent[]) {
  const tools: Record<string, number> = {}
  let tokIn = 0
  let tokOut = 0
  let first = events[0]?.timestamp
  let last = first
  for (const event of events) {
    first = first ?? event.timestamp
    last = event.timestamp ?? last
    const name = toolName(event)
    if (name) tools[name] = (tools[name] ?? 0) + 1
    const tokens = event.part?.tokens
    if (tokens) {
      tokIn += Number(tokens.input ?? 0)
      tokOut += Number(tokens.output ?? 0)
    }
  }
  return {
    tools,
    toolCalls: Object.values(tools).reduce((sum, n) => sum + n, 0),
    durationS: first && last ? Math.round((last - first) / 100) / 10 : null,
    tokens: { input: tokIn, output: tokOut },
  }
}

export async function scoreBench(input: {
  studio: BenchStudio
  events: BenchEvent[]
  studioHome: string
  expect?: string
  requires?: string[]
}): Promise<{ ok: boolean; checks: Record<string, boolean>; summary: ReturnType<typeof summarizeEvents> }> {
  const summary = summarizeEvents(input.events)
  const lastByTool = (name: string) => {
    const hits = input.events.filter((event) => toolName(event) === name)
    return hits.at(-1)
  }
  const checks: Record<string, boolean> = {}
  if (input.studio === "cad") {
    const designs = path.join(input.studioHome, "studio", "designs")
    const created = lastByTool("cad_design_create")
    const createdInput = created?.part?.state?.input
    const id = createdInput && typeof createdInput === "object" ? (createdInput as { id?: string }).id : undefined
    const designDir = id ? path.join(designs, id) : undefined
    let allStep = false
    if (designDir) {
      try {
        const design = JSON.parse(await readFile(path.join(designDir, "design.json"), "utf8")) as { parts?: Array<{ id?: string }> }
        const parts = (design.parts ?? []).map((part) => part.id).filter((part): part is string => Boolean(part))
        allStep = parts.length > 0
        for (const part of parts) {
          if (!(await Bun.file(path.join(designDir, "step", `${part}.step`)).exists())) allStep = false
        }
      } catch {
        allStep = false
      }
    }
    const qc = toolOutput(lastByTool("cad_design_qc_report"))
    checks.has_build = (summary.tools.cad_design_build ?? 0) > 0
    checks.has_qc = (summary.tools.cad_design_qc_report ?? 0) > 0
    checks.complete = qc.complete === true
    checks.artifacts = allStep
    checks.ok = checks.has_build && checks.artifacts && checks.complete
  } else if (input.studio === "pcb") {
    const build = toolOutput(lastByTool("pcb_circuit_build"))
    checks.has_create = (summary.tools.pcb_project_create ?? 0) > 0
    checks.has_build = (summary.tools.pcb_circuit_build ?? 0) > 0
    checks.design_valid = build.designValid === true || build.success === true
    checks.ok = checks.has_create && checks.has_build && checks.design_valid
    if ((input.requires ?? []).includes("sim")) {
      const sim = toolOutput(lastByTool("pcb_sim_run"))
      const experiments = sim.experiments
      checks.has_sim = sim.success === true || sim.simulationSuccess === true
      checks.has_series = Array.isArray(experiments) && experiments.length > 0
      checks.ok = Boolean(checks.ok && checks.has_sim && checks.has_series)
    }
  } else {
    const build = toolOutput(lastByTool("fw_build"))
    const simEvent = lastByTool("fw_sim_run")
    const sim = toolOutput(simEvent)
    const simInput = simEvent?.part?.state?.input
    const expectUsed = simInput && typeof simInput === "object" ? (simInput as { expect?: string }).expect : undefined
    checks.has_create = (summary.tools.fw_project_create ?? 0) > 0
    checks.has_build = build.ok === true
    checks.has_sim = sim.ok === true && sim.reason === "expect"
    checks.expect = Boolean(input.expect) && expectUsed === input.expect
    checks.ok = checks.has_create && checks.has_build && checks.has_sim && checks.expect
  }
  return { ok: Boolean(checks.ok), checks, summary }
}

function usage() {
  return `Usage: bun run bench <cad|pcb|fw> <case> [--model provider/model] [--keep]

Examples:
  bun run bench cad project-box-v0
  bun run bench pcb led-blink-v0
  bun run bench fw uart-hello-v0
`
}

async function ensureRuntime(root: string) {
  const proc = Bun.spawn(["bun", "run", "build:runtime"], { cwd: root, stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error("bun run build:runtime failed")
}

async function runOpencode(input: {
  agent: string
  model: string
  prompt: string
  files: string[]
  dir: string
  env: NodeJS.ProcessEnv
  eventsPath: string
  stderrPath: string
}) {
  const args = [
    "opencode",
    "run",
    "--print-logs",
    "--agent",
    input.agent,
    "-m",
    input.model,
    "--auto",
    "--format",
    "json",
    "--dir",
    input.dir,
  ]
  for (const file of input.files) args.push("-f", file)
  args.push("--", input.prompt)
  const proc = Bun.spawn(args, {
    cwd: input.dir,
    env: input.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const writeStream = async (stream: ReadableStream<Uint8Array> | null, filePath: string) => {
    const writer = Bun.file(filePath).writer()
    if (stream) {
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) writer.write(value)
      }
    }
    await writer.end()
  }
  const [, , code] = await Promise.all([
    writeStream(proc.stdout, input.eventsPath),
    writeStream(proc.stderr, input.stderrPath),
    proc.exited,
  ])
  return code
}

export async function prepareIsolate(root: string) {
  const isolate = await mkdtemp(path.join(tmpdir(), "osc-bench-"))
  const studioHome = path.join(isolate, "home")
  const oc = path.join(studioHome, ".opencode")
  await mkdir(path.join(oc, "agents"), { recursive: true })
  for (const id of STUDIO_IDS) {
    await copyFile(path.join(root, "studios", id, "agent", `studio-${id}.md`), path.join(oc, "agents", `studio-${id}.md`))
    const skillDir = path.join(oc, "skills", `studio-${id}`)
    await mkdir(skillDir, { recursive: true })
    await copyFile(path.join(root, "studios", id, "skill", "SKILL.md"), path.join(skillDir, "SKILL.md"))
  }
  await writeFile(
    path.join(oc, "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pathToFileURL(path.join(root, "dist", "plugin.js")).href] }, null, 2)}\n`,
  )
  return { isolate, studioHome }
}

async function main(argv: string[]) {
  const args = argv.slice(2)
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(usage())
    for (const studio of BENCH_STUDIOS) {
      const cases = await listBenchCases(studio)
      console.log(`${studio}: ${cases.map((item) => item.id).join(", ") || "(none)"}`)
    }
    return 0
  }
  const studioArg = args.shift()
  if (!studioArg || !isBenchStudio(studioArg)) {
    console.error(usage())
    return 2
  }
  if (args.length === 0 || args[0]?.startsWith("--")) {
    const cases = await listBenchCases(studioArg)
    console.log(cases.map((item) => item.id).join("\n") || `(no ${studioArg} cases)`)
    return 0
  }
  const id = args.shift()
  if (!id) {
    console.error(usage())
    return 2
  }
  let model: string | undefined
  let keep = false
  while (args.length) {
    const flag = args.shift()
    if (flag === "--keep") keep = true
    else if (flag === "--model") model = args.shift()
    else {
      console.error(`Unknown flag: ${flag}`)
      return 2
    }
  }

  const root = repoRoot()
  const bench = await loadBenchCase(studioArg, id, root)
  if (model) bench.model = model
  await ensureRuntime(root)
  const isolate = await prepareIsolate(root)
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const runDir = path.join(casesDir(studioArg, root), "runs", `${bench.id}_${bench.model.replaceAll("/", "-")}_${stamp}`)
  await mkdir(runDir, { recursive: true })
  await writeFile(path.join(runDir, "prompt.txt"), `${bench.prompt}\n`)
  await writeFile(path.join(runDir, "model.txt"), `${bench.model}\n`)
  await writeFile(path.join(runDir, "agent.txt"), `${bench.agent}\n`)
  await writeFile(path.join(runDir, "isolate.txt"), `${isolate.isolate}\n`)
  await writeFile(path.join(casesDir(studioArg, root), "runs", "LATEST"), `${runDir}\n`)

  const env = {
    ...process.env,
    OPENCODE_STUDIO_WORKSPACE: isolate.studioHome,
    OPENCODE_STUDIO_AUTOSTART: "0",
  }
  const eventsPath = path.join(runDir, "events.jsonl")
  const code = await runOpencode({
    agent: bench.agent,
    model: bench.model,
    prompt: bench.prompt,
    files: bench.files,
    dir: isolate.studioHome,
    env,
    eventsPath,
    stderrPath: path.join(runDir, "stderr.txt"),
  })
  const events = loadEvents(await readFile(eventsPath, "utf8").catch(() => ""))
  const scored = await scoreBench({
    studio: studioArg,
    events,
    studioHome: isolate.studioHome,
    expect: bench.expect,
    requires: bench.requires,
  })
  const artifactDir = path.join(runDir, "studio")
  await cp(path.join(isolate.studioHome, "studio"), artifactDir, { recursive: true }).catch(() => {})
  const report = { ...scored, exitCode: code, runDir, isolate: isolate.isolate }
  await writeFile(path.join(runDir, "score.json"), `${JSON.stringify(report, null, 2)}\n`)
  if (!keep) await rm(isolate.isolate, { recursive: true, force: true })
  console.log(JSON.stringify({ ok: scored.ok && code === 0, checks: scored.checks, runDir, exitCode: code }, null, 2))
  return scored.ok && code === 0 ? 0 : 1
}

if (import.meta.main) {
  main(process.argv).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(2)
    },
  )
}
