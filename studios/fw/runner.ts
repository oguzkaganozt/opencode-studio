import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { type FwChipSpec, fwChipSpec } from "./chips"
import { ensureIdf, ensureSimEngine, idfCommand, idfEnv, type ResolvedFwBinary } from "./engines"
import { buildLogPath, buildRecordPath, type FwBuildRecord, type FwProject, type FwRunRecord, simDir, uartLogPath } from "./workspace"

export type RunCommandResult = {
  code: number | null
  stdout: string
  stderr: string
  reason: FwRunRecord["reason"]
  matched?: string
}

export type RunCommand = (input: {
  command: string[]
  cwd: string
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs: number
  expect?: string
  fail?: string
}) => Promise<RunCommandResult>

export type FwEngineResolve = {
  idf?: () => ResolvedFwBinary
  sim?: (spec: FwChipSpec) => ResolvedFwBinary
}

const DEFAULT_TIMEOUT_MS = 20_000
const LOG_CAP = 200_000

export async function defaultRunCommand(input: {
  command: string[]
  cwd: string
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs: number
  expect?: string
  fail?: string
}): Promise<RunCommandResult> {
  const proc = Bun.spawn(input.command, {
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: input.signal,
    detached: true,
  })

  let stdout = ""
  let stderr = ""
  let reason: FwRunRecord["reason"] = "exit"
  let matched: string | undefined
  let settled = false

  const killProc = () => {
    try {
      process.kill(-proc.pid, "SIGKILL")
    } catch {
      proc.kill()
    }
  }

  const finish = async (next: FwRunRecord["reason"], hit?: string) => {
    if (settled) return
    settled = true
    reason = next
    matched = hit
    killProc()
    await proc.exited.catch(() => undefined)
  }

  const consider = async (chunk: string, stream: "stdout" | "stderr") => {
    if (stream === "stdout") stdout = cap(`${stdout}${chunk}`)
    else stderr = cap(`${stderr}${chunk}`)
    const haystack = `${stdout}\n${stderr}`
    if (input.fail && haystack.includes(input.fail)) {
      await finish("fail", input.fail)
      return
    }
    if (input.expect && haystack.includes(input.expect)) {
      await finish("expect", input.expect)
    }
  }

  const read = async (readable: ReadableStream<Uint8Array> | null, stream: "stdout" | "stderr") => {
    if (!readable) return
    const reader = readable.getReader()
    const decoder = new TextDecoder()
    while (!settled) {
      const { done, value } = await reader.read()
      if (done) break
      await consider(decoder.decode(value, { stream: true }), stream)
    }
  }

  const timeout = setTimeout(
    () => {
      void finish("timeout")
    },
    Math.max(1, input.timeoutMs),
  )

  try {
    await Promise.race([
      Promise.all([read(proc.stdout, "stdout"), read(proc.stderr, "stderr"), proc.exited]).then(async () => {
        if (!settled) {
          settled = true
          reason = "exit"
        }
      }),
      input.signal
        ? abortPromise(input.signal).then(async () => {
            await finish("abort")
          })
        : new Promise<void>(() => undefined),
    ])
  } finally {
    clearTimeout(timeout)
    if (!settled) killProc()
  }

  const code = await proc.exited.catch(() => null)
  return { code, stdout, stderr, reason, matched }
}

function abortPromise(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}

function cap(value: string) {
  if (value.length <= LOG_CAP) return value
  return value.slice(value.length - LOG_CAP)
}

export async function buildFwProject(
  project: FwProject,
  options?: { signal?: AbortSignal; runCommand?: RunCommand; engines?: FwEngineResolve },
): Promise<{ record: FwBuildRecord; log: string }> {
  const idf = options?.engines?.idf?.() ?? (await ensureIdf())
  const spec = fwChipSpec(project.chip)
  const run = options?.runCommand ?? defaultRunCommand
  const env = idfEnv(idf)
  await mkdir(simDir(project.directory), { recursive: true })
  const target = await run({
    command: idfCommand(idf, ["-C", project.directory, "set-target", spec.chip]),
    cwd: project.directory,
    env,
    signal: options?.signal,
    timeoutMs: 180_000,
  })
  if (target.reason === "abort") throw new Error("fw_build aborted")
  if (target.reason !== "exit" || target.code !== 0) {
    const log = cap(`${target.stdout}${target.stderr}`)
    const record: FwBuildRecord = {
      ok: false,
      finishedAt: new Date().toISOString(),
      exitCode: target.code,
      logPath: buildLogPath(project.directory),
    }
    await writeFile(record.logPath, log)
    await writeFile(buildRecordPath(project.directory), `${JSON.stringify(record, null, 2)}\n`)
    return { record, log }
  }
  const build = await run({
    command: idfCommand(idf, ["-C", project.directory, "build"]),
    cwd: project.directory,
    env,
    signal: options?.signal,
    timeoutMs: 300_000,
  })
  const log = cap(`${target.stdout}${target.stderr}\n${build.stdout}${build.stderr}`)
  const record: FwBuildRecord = {
    ok: build.reason === "exit" && build.code === 0,
    finishedAt: new Date().toISOString(),
    exitCode: build.code,
    logPath: buildLogPath(project.directory),
  }
  await writeFile(record.logPath, log)
  await writeFile(buildRecordPath(project.directory), `${JSON.stringify(record, null, 2)}\n`)
  return { record, log }
}

export async function simulateFwProject(
  project: FwProject,
  options: {
    expect?: string
    fail?: string
    timeoutMs?: number
    signal?: AbortSignal
    runCommand?: RunCommand
    engines?: FwEngineResolve
  } = {},
): Promise<{ record: FwRunRecord; log: string }> {
  const spec = fwChipSpec(project.chip)
  const idf = options.engines?.idf?.() ?? (await ensureIdf())
  const engine = options.engines?.sim?.(spec) ?? (await ensureSimEngine(spec))
  const run = options.runCommand ?? defaultRunCommand
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  await mkdir(simDir(project.directory), { recursive: true })

  const started = Date.now()
  const result =
    spec.engine === "qemu"
      ? await runQemu(project, spec, idf, engine, { ...options, run, timeoutMs })
      : await runEspEmu(project, spec, idf, engine.path, { ...options, run, timeoutMs })

  const log = cap(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`)
  const ok = result.reason === "expect" || (result.reason === "exit" && result.code === 0 && !options.expect)
  const record: FwRunRecord = {
    ok,
    reason: result.reason,
    engine: spec.engine,
    chip: spec.chip,
    expect: options.expect,
    fail: options.fail,
    matched: result.matched,
    durationMs: Date.now() - started,
    finishedAt: new Date().toISOString(),
    exitCode: result.code,
    logPath: uartLogPath(project.directory),
  }
  await writeFile(record.logPath, log)
  await writeFile(path.join(simDir(project.directory), "last.json"), `${JSON.stringify(record, null, 2)}\n`)
  return { record, log }
}

async function runQemu(
  project: FwProject,
  spec: FwChipSpec,
  idf: ResolvedFwBinary,
  qemu: ResolvedFwBinary,
  options: { expect?: string; fail?: string; timeoutMs: number; signal?: AbortSignal; run: RunCommand },
) {
  const merged = await options.run({
    command: idfCommand(idf, ["-C", project.directory, "merge-bin", "--fill-flash-size", "4MB"]),
    cwd: project.directory,
    env: idfEnv(idf),
    signal: options.signal,
    timeoutMs: 120_000,
  })
  if (merged.reason === "abort") return merged
  if (merged.reason !== "exit" || merged.code !== 0) {
    return { ...merged, reason: "exit" as const }
  }
  const firmware = path.join(project.directory, "build", "merged-binary.bin")
  const efusePath = path.join(project.directory, "build", "qemu_efuse.bin")
  if (spec.qemuEfuseHex) await writeFile(efusePath, Buffer.from(spec.qemuEfuseHex, "hex"))
  return options.run({
    command: [
      qemu.path,
      ...(spec.qemuArgs ?? ["-M", spec.chip]),
      "-drive",
      `file=${firmware},if=mtd,format=raw`,
      ...(spec.qemuEfuseHex
        ? [
            "-drive",
            `file=${efusePath},if=none,format=raw,id=efuse`,
            "-global",
            `driver=nvram.${spec.chip}.efuse,property=drive,value=efuse`,
          ]
        : []),
      "-global",
      `driver=timer.${spec.chip}.timg,property=wdt_disable,value=true`,
      "-nic",
      "user,model=open_eth",
      "-nographic",
      "-serial",
      "mon:stdio",
    ],
    cwd: project.directory,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    expect: options.expect,
    fail: options.fail,
  })
}

async function runEspEmu(
  project: FwProject,
  spec: FwChipSpec,
  idf: ResolvedFwBinary,
  espEmuPath: string,
  options: { expect?: string; fail?: string; timeoutMs: number; signal?: AbortSignal; run: RunCommand },
) {
  const merged = await options.run({
    command: idfCommand(idf, ["-C", project.directory, "merge-bin", "--fill-flash-size", "4MB"]),
    cwd: project.directory,
    env: idfEnv(idf),
    signal: options.signal,
    timeoutMs: 120_000,
  })
  if (merged.reason === "abort") return merged
  if (merged.reason !== "exit" || merged.code !== 0) {
    return { ...merged, reason: "exit" as const }
  }
  const firmware = path.join(project.directory, "build", "merged-binary.bin")
  return options.run({
    command: [espEmuPath, "--chip", spec.chip, "--firmware", firmware, "--timeout", `${options.timeoutMs}ms`],
    cwd: project.directory,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    expect: options.expect,
    fail: options.fail,
  })
}
