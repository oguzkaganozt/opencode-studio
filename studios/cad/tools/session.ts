import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface, type Interface } from "node:readline"
import { ensureUv } from "../../../src/core/engines"
import { syncCadEngineUvProject } from "../../../src/core/package-meta"

export const CAD_RUNTIME_SESSION_TIMEOUT_MS = 120_000
/** @deprecated Public tools use cad_* names; session protocol is internal. */
export const CAD_SESSION_TOOL_PREFIX = "cad_"

type JsonRpcId = number
type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: unknown
}
type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}
type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type CadRuntimeCallResult = {
  text: string
  isError: boolean
  images: Array<{ mimeType: string; data: string }>
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Long-lived Studio CAD runtime (Python) owned by the CAD plugin.
 * One process (--in-process): session tools + studio_build. Stdio JSON-RPC.
 * Same CAD engine uv project as product builds.
 */
export class CadRuntimeSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private nextId = 1
  private pending = new Map<JsonRpcId, Pending>()
  private starting: Promise<void> | null = null
  private stopping: Promise<void> | null = null
  private closed = false

  constructor(
    private readonly engineProjectDir: string,
    private readonly cwd: string,
  ) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: {
      signal?: AbortSignal
      timeoutMs?: number
      /** When false, timeout/abort rejects the call but keeps the Python session alive (for studio_build). Default true. */
      resetSessionOnFailure?: boolean
    },
  ): Promise<CadRuntimeCallResult> {
    await this.ensureStarted(options?.signal)
    const timeoutMs = options?.timeoutMs ?? CAD_RUNTIME_SESSION_TIMEOUT_MS
    const result = await this.request(
      "tools/call",
      {
        name,
        arguments: args,
      },
      timeoutMs,
      options?.signal,
      options?.resetSessionOnFailure !== false,
    )
    return parseToolResult(result)
  }

  async close(): Promise<void> {
    this.closed = true
    await this.stopChild(new Error("build123d session closed"))
  }

  private async stopChild(reason: Error): Promise<void> {
    if (this.stopping) {
      await this.stopping
      return
    }
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(reason)
      this.pending.delete(id)
    }
    const child = this.child
    this.child = null
    this.reader?.close()
    this.reader = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const stopping = new Promise<void>((resolve) => {
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const killGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return
        try {
          process.kill(-child.pid, signal)
        } catch {
          child.kill(signal)
        }
      }
      const done = () => {
        if (killTimer) clearTimeout(killTimer)
        resolve()
      }
      child.once("exit", done)
      try {
        killGroup("SIGTERM")
      } catch {
        resolve()
        return
      }
      killTimer = setTimeout(() => {
        try {
          killGroup("SIGKILL")
        } catch {
          /* ignore */
        }
        resolve()
      }, 2_000).unref()
    })
    this.stopping = stopping
    try {
      await stopping
    } finally {
      if (this.stopping === stopping) this.stopping = null
    }
  }

  private async ensureStarted(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("build123d session start aborted")
    if (this.closed) throw new Error("build123d session closed")
    if (this.stopping) await this.stopping
    if (this.child && !this.child.killed) return
    if (this.starting) {
      await this.starting
      return
    }
    this.starting = this.start(signal).finally(() => {
      this.starting = null
    })
    await this.starting
  }

  private async start(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("build123d session start aborted")
    const uv = await ensureUv()
    await syncCadEngineUvProject(uv.path, this.engineProjectDir, { signal })

    // Single Python CAD process: --in-process disables the runtime's internal
    // WorkerSession child so session + studio_build share one address space.
    const child = spawn(
      uv.path,
      ["--project", this.engineProjectDir, "run", "--no-sync", "studio-cad-runtime", "--in-process"],
      {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          BUILD123D_IN_PROCESS: "1",
        },
        detached: true,
      },
    )
    this.child = child
    this.reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.reader.on("line", (line) => this.onLine(line))
    child.stderr?.on("data", () => {
      /* keep pipe draining; errors surface via RPC / exit */
    })
    child.on("exit", (code, stopSignal) => {
      if (this.child !== child) return
      const err = new Error(`build123d session exited (code ${code ?? "null"}, signal ${stopSignal ?? "null"})`)
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(err)
        this.pending.delete(id)
      }
      this.child = null
      this.reader?.close()
      this.reader = null
    })

    try {
      await this.request(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "opencode-studio", version: "1" },
        },
        60_000,
        signal,
      )
      this.notify("notifications/initialized")
    } catch (error) {
      await this.stopChild(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private onLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: JsonRpcResponse
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse
    } catch {
      return
    }
    if (msg.id === undefined || msg.id === null) return
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.error) {
      pending.reject(new Error(msg.error.message || `JSON-RPC error ${msg.error.code}`))
      return
    }
    pending.resolve(msg.result)
  }

  private notify(method: string, params?: unknown) {
    const payload: JsonRpcNotification = { jsonrpc: "2.0", method, params }
    this.write(payload)
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
    resetSessionOnFailure = true,
  ): Promise<unknown> {
    if (!this.child?.stdin) return Promise.reject(new Error("build123d session not running"))
    if (signal?.aborted) return Promise.reject(new Error(`build123d ${method} aborted`))
    const id = this.nextId++
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        signal?.removeEventListener("abort", onAbort)
        const error = new Error(
          resetSessionOnFailure
            ? `build123d ${method} timed out after ${timeoutMs}ms; session reset`
            : `build123d ${method} timed out after ${timeoutMs}ms`,
        )
        reject(error)
        if (resetSessionOnFailure) void this.stopChild(error)
      }, timeoutMs)
      const onAbort = () => {
        this.pending.delete(id)
        clearTimeout(timer)
        const error = new Error(
          resetSessionOnFailure ? `build123d ${method} aborted; session reset` : `build123d ${method} aborted`,
        )
        reject(error)
        if (resetSessionOnFailure) void this.stopChild(error)
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort)
          reject(error)
        },
        timer,
      })
      try {
        this.write(payload)
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private write(payload: JsonRpcRequest | JsonRpcNotification) {
    const child = this.child
    if (!child?.stdin || child.killed) throw new Error("build123d session not running")
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }
}

function parseToolResult(raw: unknown): CadRuntimeCallResult {
  if (!raw || typeof raw !== "object") {
    return { text: String(raw ?? ""), isError: false, images: [] }
  }
  const result = raw as {
    content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }>
    isError?: boolean
  }
  const texts: string[] = []
  const images: Array<{ mimeType: string; data: string }> = []
  for (const part of result.content ?? []) {
    if (part?.type === "text" && typeof part.text === "string") texts.push(part.text)
    if (part?.type === "image" && typeof part.data === "string") {
      images.push({ mimeType: typeof part.mimeType === "string" ? part.mimeType : "image/png", data: part.data })
    }
  }
  return {
    text: texts.join("\n") || (result.isError ? "build123d tool error" : ""),
    isError: Boolean(result.isError),
    images,
  }
}

const sessions = new Map<string, CadRuntimeSession>()

export function getCadRuntimeSession(engineProjectDir: string, cwd: string): CadRuntimeSession {
  const key = `${engineProjectDir}::${cwd}`
  const existing = sessions.get(key)
  if (existing) return existing
  const session = new CadRuntimeSession(engineProjectDir, cwd)
  sessions.set(key, session)
  return session
}
