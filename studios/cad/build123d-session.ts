import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface, type Interface } from "node:readline"
import { ensureUv } from "../../src/core/engines"
import { syncForgeUvProject } from "../../src/core/package-meta"

export const BUILD123D_SESSION_TIMEOUT_MS = 120_000
export const BUILD123D_TOOL_PREFIX = "build123d_"

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

export type Build123dCallResult = {
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
 * Long-lived build123d-mcp child process owned by the CAD plugin.
 * Speaks MCP stdio (newline-delimited JSON-RPC). Same forge uv project as design_build.
 */
export class Build123dSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private nextId = 1
  private pending = new Map<JsonRpcId, Pending>()
  private starting: Promise<void> | null = null
  private stopping: Promise<void> | null = null
  private closed = false

  constructor(
    private readonly forgeProjectDir: string,
    private readonly cwd: string,
  ) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Build123dCallResult> {
    await this.ensureStarted(options?.signal)
    const timeoutMs = options?.timeoutMs ?? BUILD123D_SESSION_TIMEOUT_MS
    const result = await this.request(
      "tools/call",
      {
        name,
        arguments: args,
      },
      timeoutMs,
      options?.signal,
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
    await syncForgeUvProject(uv.path, this.forgeProjectDir, { signal })

    const child = spawn(uv.path, ["--project", this.forgeProjectDir, "run", "--no-sync", "build123d-mcp"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      detached: true,
    })
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

  private request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (!this.child?.stdin) return Promise.reject(new Error("build123d session not running"))
    if (signal?.aborted) return Promise.reject(new Error(`build123d ${method} aborted`))
    const id = this.nextId++
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        signal?.removeEventListener("abort", onAbort)
        const error = new Error(`build123d ${method} timed out after ${timeoutMs}ms; session reset`)
        reject(error)
        void this.stopChild(error)
      }, timeoutMs)
      const onAbort = () => {
        this.pending.delete(id)
        clearTimeout(timer)
        const error = new Error(`build123d ${method} aborted; session reset`)
        reject(error)
        void this.stopChild(error)
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

function parseToolResult(raw: unknown): Build123dCallResult {
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

const sessions = new Map<string, Build123dSession>()

export function getBuild123dSession(forgeProjectDir: string, cwd: string): Build123dSession {
  const key = `${forgeProjectDir}::${cwd}`
  const existing = sessions.get(key)
  if (existing) return existing
  const session = new Build123dSession(forgeProjectDir, cwd)
  sessions.set(key, session)
  return session
}
