import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import envPaths from "env-paths"
import { agentNameFor } from "../src/core/package-meta"
import { STUDIO_IDS } from "../src/core/registry"
import { startHost } from "../src/server"
import { ensurePublicArtifactLinks } from "../studios/cad/host/artifacts"

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
  const agent = meta(markdown, "agent") ?? agentNameFor(studio)
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
  requireNoBash?: boolean
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
    const exports = input.events.filter((event) => toolName(event) === "pcb_circuit_export").map((event) => toolOutput(event))
    const blockers = Array.isArray(build.manufacturingBlockers) ? build.manufacturingBlockers : null
    checks.has_create = (summary.tools.pcb_project_create ?? 0) > 0
    checks.has_build = (summary.tools.pcb_circuit_build ?? 0) > 0
    checks.has_export = (summary.tools.pcb_circuit_export ?? 0) > 0
    checks.build_success = build.success === true
    checks.design_valid = build.designValid === true
    checks.fabrication_ready = build.fabricationReady === true
    checks.no_manufacturing_blockers = blockers !== null && blockers.length === 0
    checks.pcb_generated = exports.some(
      (result) => result.success === true && Array.isArray(result.generatedFormats) && result.generatedFormats.includes("pcb"),
    )
    if (input.requireNoBash) checks.no_bash = (summary.tools.bash ?? 0) === 0
    checks.ok =
      checks.has_create &&
      checks.has_build &&
      checks.has_export &&
      checks.build_success &&
      checks.design_valid &&
      checks.fabrication_ready &&
      checks.no_manufacturing_blockers &&
      checks.pcb_generated &&
      (!input.requireNoBash || checks.no_bash)
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
  return `Usage: bun run bench <cad|pcb|fw> <case> [--model provider/model] [--variant name] [--deny-bash] [--keep] [--headless]

Starts an isolated Studio viewer by default (does not use port 4173).
The viewer stays up after the run until Ctrl+C. Pass --headless to skip it.

Examples:
  bun run bench cad project-box-v0
  bun run bench pcb led-blink-v0 --headless
`
}

async function ensureRuntime(root: string) {
  const proc = Bun.spawn(["bun", "run", "build:runtime"], { cwd: root, stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error("bun run build:runtime failed")
}

async function ensureUi(root: string) {
  if (await Bun.file(path.join(root, "dist", "ui", "index.html")).exists()) return
  const proc = Bun.spawn(["bun", "run", "build:ui"], { cwd: root, stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error("bun run build:ui failed")
}

function idleOpenCodeBridge() {
  return {
    proxy: async () => new Response("Bench viewer has no parent OpenCode", { status: 503 }),
    webSocketTarget: async () => {
      throw new Error("Bench viewer has no parent OpenCode")
    },
    close: () => {},
  }
}

async function startBenchViewer(root: string, studioHome: string, studio: BenchStudio) {
  await ensureUi(root)
  const handle = await startHost({
    studioRoot: studioHome,
    hostname: "127.0.0.1",
    port: 0,
    packageRoot: root,
    uiDirectory: path.join(root, "dist", "ui"),
    openCodeBridge: idleOpenCodeBridge(),
    handleSignals: false,
  })
  const studioUrl = `${handle.studioUrl}/studios/${studio}`
  return { handle, studioUrl }
}

async function runOpencode(input: {
  agent: string
  model: string
  variant?: string
  prompt: string
  files: string[]
  dir: string
  env: NodeJS.ProcessEnv
  eventsPath: string
  stderrPath: string
}) {
  const args = ["opencode", "run", "--print-logs", "--agent", input.agent, "-m", input.model]
  if (input.variant) args.push("--variant", input.variant)
  args.push("--auto", "--format", "json", "--dir", input.dir)
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

export function benchLockPath(root: string) {
  return path.join(tmpdir(), `osc-bench-${Buffer.from(root).toString("hex").slice(0, 16)}.lock`)
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function acquireBenchLock(root: string, label: string) {
  const lockPath = benchLockPath(root)
  try {
    const existing = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number; label?: string }
    if (typeof existing.pid === "number" && pidAlive(existing.pid)) {
      throw new Error(`A bench is already running (pid ${existing.pid}${existing.label ? `: ${existing.label}` : ""}).`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A bench is already running")) throw error
  }
  await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, label, at: new Date().toISOString() })}\n`)
  return lockPath
}

export async function releaseBenchLock(lockPath: string) {
  await rm(lockPath, { force: true })
}

export type BenchIsolate = {
  isolate: string
  studioHome: string
  userHome: string
  xdgConfigHome: string
  xdgDataHome: string
  xdgCacheHome: string
  xdgStateHome: string
}

export function benchEnvironment(isolate: BenchIsolate, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: isolate.userHome,
    XDG_CONFIG_HOME: isolate.xdgConfigHome,
    XDG_DATA_HOME: isolate.xdgDataHome,
    XDG_CACHE_HOME: isolate.xdgCacheHome,
    XDG_STATE_HOME: isolate.xdgStateHome,
    OPENCODE_STUDIO_WORKSPACE: isolate.studioHome,
    OPENCODE_STUDIO_AUTOSTART: "0",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
  }
  for (const key of [
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_TUI_CONFIG",
    "OPENCODE_DISABLE_PROJECT_CONFIG",
  ]) {
    delete env[key]
  }
  return env
}

export async function prepareIsolate(root: string, options?: { xdgDataHome?: string; denyBash?: boolean }): Promise<BenchIsolate> {
  const isolate = await mkdtemp(path.join(tmpdir(), "osc-bench-"))
  const studioHome = path.join(isolate, "home")
  const userHome = path.join(isolate, "user-home")
  const xdgConfigHome = path.join(isolate, "xdg", "config")
  const xdgDataHome = options?.xdgDataHome ?? path.dirname(envPaths("opencode", { suffix: "" }).data)
  const xdgCacheHome = path.join(isolate, "xdg", "cache")
  const xdgStateHome = path.join(isolate, "xdg", "state")
  const oc = path.join(studioHome, ".opencode")
  await Promise.all(
    [userHome, xdgConfigHome, xdgCacheHome, xdgStateHome, path.join(oc, "agents")].map((dir) => mkdir(dir, { recursive: true })),
  )
  for (const id of STUDIO_IDS) {
    const agentDir = path.join(root, "studios", id, "agent")
    for (const name of (await readdir(agentDir)).filter((file) => file.endsWith(".md"))) {
      const sourcePath = path.join(agentDir, name)
      const destinationPath = path.join(oc, "agents", name)
      if (!options?.denyBash) {
        await copyFile(sourcePath, destinationPath)
        continue
      }
      const source = await readFile(sourcePath, "utf8")
      const denied = /^ {2}bash: deny$/m.test(source)
        ? source
        : source.replace(/(permission:\n {2}["']?\*["']?: allow\n)/, "$1  bash: deny\n")
      if (!/^ {2}bash: deny$/m.test(denied)) throw new Error(`Could not deny Bash in benchmark agent ${name}`)
      await writeFile(destinationPath, denied)
    }
    const skillDir = path.join(oc, "skills", `studio-${id}`)
    await mkdir(skillDir, { recursive: true })
    await copyFile(path.join(root, "studios", id, "skill", "SKILL.md"), path.join(skillDir, "SKILL.md"))
    const extrasDir = path.join(root, "studios", id, "skills")
    for (const extra of await readdir(extrasDir).catch(() => [] as string[])) {
      const skillFile = path.join(extrasDir, extra, "SKILL.md")
      if (!(await Bun.file(skillFile).exists())) continue
      const dest = path.join(oc, "skills", extra)
      await mkdir(dest, { recursive: true })
      await copyFile(skillFile, path.join(dest, "SKILL.md"))
    }
  }
  await writeFile(
    path.join(oc, "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: [pathToFileURL(path.join(root, "dist", "plugin.js")).href],
        ...(options?.denyBash ? { permission: { bash: "deny" } } : {}),
      },
      null,
      2,
    )}\n`,
  )
  return { isolate, studioHome, userHome, xdgConfigHome, xdgDataHome, xdgCacheHome, xdgStateHome }
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
  let variant: string | undefined
  let keep = false
  let headless = false
  let denyBash = false
  while (args.length) {
    const flag = args.shift()
    if (flag === "--keep") keep = true
    else if (flag === "--headless") headless = true
    else if (flag === "--deny-bash") denyBash = true
    else if (flag === "--model") model = args.shift()
    else if (flag === "--variant") variant = args.shift()
    else {
      console.error(`Unknown flag: ${flag}`)
      return 2
    }
  }

  const root = repoRoot()
  const bench = await loadBenchCase(studioArg, id, root)
  if (model) bench.model = model
  const lockPath = await acquireBenchLock(root, `${studioArg} ${bench.id}`)
  try {
    await ensureRuntime(root)
    const isolate = await prepareIsolate(root, { denyBash })
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")
    const modelLabel = [bench.model.replaceAll("/", "-"), variant].filter(Boolean).join("-")
    const runDir = path.join(casesDir(studioArg, root), "runs", `${bench.id}_${modelLabel}_${stamp}`)
    await mkdir(runDir, { recursive: true })
    await writeFile(path.join(runDir, "prompt.txt"), `${bench.prompt}\n`)
    await writeFile(path.join(runDir, "model.txt"), `${bench.model}\n`)
    if (variant) await writeFile(path.join(runDir, "variant.txt"), `${variant}\n`)
    await writeFile(path.join(runDir, "agent.txt"), `${bench.agent}\n`)
    await writeFile(path.join(runDir, "isolate.txt"), `${isolate.isolate}\n`)
    await writeFile(path.join(casesDir(studioArg, root), "runs", "LATEST"), `${runDir}\n`)

    const env = benchEnvironment(isolate)
    let viewer: Awaited<ReturnType<typeof startBenchViewer>> | undefined
    if (!headless) {
      try {
        viewer = await startBenchViewer(root, isolate.studioHome, studioArg)
        await writeFile(path.join(runDir, "viewer.txt"), `${viewer.studioUrl}\n`)
        console.log(`viewer ${viewer.studioUrl}`)
      } catch (error) {
        console.error(`viewer failed (bench continues): ${error instanceof Error ? error.message : error}`)
      }
    }
    const eventsPath = path.join(runDir, "events.jsonl")
    try {
      const code = await runOpencode({
        agent: bench.agent,
        model: bench.model,
        variant,
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
        requireNoBash: denyBash,
      })
      const artifactDir = path.join(runDir, "studio")
      await cp(path.join(isolate.studioHome, "studio"), artifactDir, { recursive: true }).catch(() => {})
      const designsDir = path.join(artifactDir, "designs")
      for (const name of await readdir(designsDir).catch(() => [] as string[])) {
        await ensurePublicArtifactLinks(path.join(designsDir, name)).catch(() => {})
      }
      const report = { ...scored, exitCode: code, runDir, isolate: isolate.isolate, viewer: viewer?.studioUrl ?? null }
      await writeFile(path.join(runDir, "score.json"), `${JSON.stringify(report, null, 2)}\n`)
      console.log(
        JSON.stringify(
          { ok: scored.ok && code === 0, checks: scored.checks, runDir, viewer: viewer?.studioUrl ?? null, exitCode: code },
          null,
          2,
        ),
      )
      if (viewer) {
        console.log(`viewer still up ${viewer.studioUrl}`)
        console.log("Ctrl+C to stop the viewer")
        await new Promise<void>((resolve) => {
          const done = () => {
            process.off("SIGINT", done)
            process.off("SIGTERM", done)
            resolve()
          }
          process.on("SIGINT", done)
          process.on("SIGTERM", done)
        })
      }
      return scored.ok && code === 0 ? 0 : 1
    } finally {
      viewer?.handle.stop()
      if (!keep) await rm(isolate.isolate, { recursive: true, force: true })
    }
  } finally {
    await releaseBenchLock(lockPath)
  }
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
