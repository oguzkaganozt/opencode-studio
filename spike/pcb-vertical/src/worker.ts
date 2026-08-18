import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { designDir } from "./host.ts"

export type WorkerResult = {
  engine: "tscircuit" | "docker"
  status: "pass" | "fail"
  findings: { severity: "error"; message: string }[]
  circuitJsonPath?: string
}

const engineRunner = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "engine", "run.mjs")

function spawnJson(command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    const onAbort = () => child.kill("SIGKILL")
    signal?.addEventListener("abort", onAbort, { once: true })
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort)
      reject(error)
    })
    child.on("close", () => {
      signal?.removeEventListener("abort", onAbort)
      if (signal?.aborted) {
        reject(new Error("aborted"))
        return
      }
      try {
        resolve(JSON.parse(stdout) as WorkerResult)
      } catch {
        reject(new Error(stderr || stdout || "worker produced no JSON"))
      }
    })
  })
}

export async function runPcbTask(root: string, id: string, signal?: AbortSignal): Promise<WorkerResult> {
  const projectDir = designDir(root, id)
  if (process.env.PCB_WORKER === "docker") {
    return spawnJson(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${projectDir}:/work`,
        "-v",
        `${path.dirname(engineRunner)}:/engine:ro`,
        "-w",
        "/work",
        "oven/bun:1.3-debian",
        "bun",
        "/engine/run.mjs",
        "/work",
      ],
      process.env,
      signal,
    )
  }
  return spawnJson(process.execPath, [engineRunner, projectDir], process.env, signal)
}
