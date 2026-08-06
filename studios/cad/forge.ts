import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { ensureUv } from "../../src/core/engines"
import { syncForgeUvProject } from "../../src/core/package-meta"
import { isInside } from "../../src/core/paths"
import { resolveDesignDirectory, type StudioLayout } from "./library"
import { readArtifactManifest, readDesignManifest, scaffoldDesignManifest } from "./manifest"

/** Timed budget for the forge *build* only (deps are synced separately). */
const FORGE_BUILD_TIMEOUT_MS = 120_000
const FORGE_KILL_GRACE_MS = 2_000
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024

export type ForgeBuildResult = {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  manifestPath: string | null
  designDir: string
}

export type ForgeRunner = (input: { forgeProjectDir: string; designDir: string; signal?: AbortSignal }) => Promise<ForgeBuildResult>

export const defaultForgeRunner: ForgeRunner = async ({ forgeProjectDir, designDir, signal }) => {
  const uv = await ensureUv()
  // Dep install outside the build timer — cold OCP/uv must not compete with 120s build kill.
  try {
    await syncForgeUvProject(uv.path, forgeProjectDir, { signal })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      exitCode: signal?.aborted ? 130 : 1,
      stdout: "",
      stderr: message,
      manifestPath: null,
      designDir,
    }
  }

  // --no-sync: environment already prepared; timer covers geometry build only.
  const child = spawn(uv.path, ["--project", forgeProjectDir, "run", "--no-sync", "forge", "build", designDir], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  let stdout = ""
  let stderr = ""
  let termination: "timeout" | "abort" | null = null
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const append = (current: string, chunk: Buffer) => {
    if (current.length >= MAX_PROCESS_OUTPUT_BYTES) return current
    const next = current + chunk.toString()
    return next.length > MAX_PROCESS_OUTPUT_BYTES ? `${next.slice(0, MAX_PROCESS_OUTPUT_BYTES)}\n[process output truncated]` : next
  }
  const killGroup = (killSignal: NodeJS.Signals) => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, killSignal)
    } catch {
      child.kill(killSignal)
    }
  }
  const terminate = (reason: "timeout" | "abort") => {
    if (termination) return
    termination = reason
    killGroup("SIGTERM")
    killTimer = setTimeout(() => killGroup("SIGKILL"), FORGE_KILL_GRACE_MS)
  }
  const timer = setTimeout(() => {
    terminate("timeout")
  }, FORGE_BUILD_TIMEOUT_MS)
  const abort = () => terminate("abort")
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  try {
    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr = append(stderr, chunk)
    })
    const { status, closeSignal } = await new Promise<{ status: number | null; closeSignal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on("error", reject)
      child.on("close", (status, closeSignal) => resolve({ status, closeSignal }))
    })
    const code = status ?? (termination === "timeout" ? 124 : termination === "abort" ? 130 : 1)
    if (closeSignal) stderr = append(stderr, Buffer.from(`\nProcess terminated by ${closeSignal}`))
    return {
      ok: code === 0 && termination === null && closeSignal === null,
      exitCode: code,
      stdout,
      stderr,
      manifestPath: null,
      designDir,
    }
  } finally {
    clearTimeout(timer)
    if (killTimer) clearTimeout(killTimer)
    signal?.removeEventListener("abort", abort)
  }
}

export async function buildDesign(
  layout: StudioLayout,
  id: string,
  forgeProjectDir: string,
  runner: ForgeRunner = defaultForgeRunner,
  signal?: AbortSignal,
): Promise<ForgeBuildResult & { manifestPath: string | null }> {
  const designDir = await resolveDesignDirectory(layout, id)
  await readDesignManifest(designDir, id)
  const result = await runner({ forgeProjectDir, designDir, signal })
  if (!result.ok) return { ...result, manifestPath: null }
  const artifact = await readArtifactManifest(designDir, id)
  if (!artifact) {
    return {
      ...result,
      ok: false,
      exitCode: 1,
      stderr: `${result.stderr}\nForge exited successfully but manifest.json is missing`,
      manifestPath: null,
    }
  }
  for (const part of artifact.parts) {
    for (const file of Object.values(part.files)) {
      const artifactPath = path.resolve(designDir, file)
      if (!isInside(designDir, artifactPath) || !(await lstat(artifactPath)).isFile()) {
        return {
          ...result,
          ok: false,
          exitCode: 1,
          stderr: `${result.stderr}\nBuilt artifact is missing or unsafe: ${file}`,
          manifestPath: null,
        }
      }
    }
  }
  return { ...result, manifestPath: path.join(designDir, "manifest.json") }
}

export async function scaffoldDesign(
  layout: StudioLayout,
  id: string,
  parts: Array<{ id: string; source?: string }>,
): Promise<{ designDir: string; manifest: ReturnType<typeof scaffoldDesignManifest> }> {
  const designDir = await resolveDesignDirectory(layout, id)
  if (!isInside(layout.root, designDir)) {
    throw new Error(`Design id escapes designs root: ${id}`)
  }
  const manifest = scaffoldDesignManifest(id, parts)
  if (
    await lstat(designDir).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`Design already exists: ${id}`)

  await mkdir(layout.root, { recursive: true })
  const temporary = path.join(layout.root, `.${id}.${randomUUID()}.tmp`)
  try {
    await mkdir(path.join(temporary, "parts"), { recursive: true })
    await mkdir(path.join(temporary, "renders"), { recursive: true })
    await writeFile(path.join(temporary, "design.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    await writeFile(
      path.join(temporary, "params.py"),
      `# Shared dimensions and tolerances for the "${id}" design.\n# Import these from every part module:\n#   from params import ...\n\nEPS = 0.01\n`,
      "utf8",
    )
    const createdSources = new Set<string>()
    for (const part of manifest.parts) {
      if (createdSources.has(part.source)) continue
      createdSources.add(part.source)
      const sourcePath = path.join(temporary, part.source)
      await mkdir(path.dirname(sourcePath), { recursive: true })
      await writeFile(
        sourcePath,
        `"""Parametric source for ${part.id}."""\n\ndef build():\n    raise NotImplementedError("Model ${part.id} before design_build")\n`,
        { encoding: "utf8", flag: "wx" },
      )
    }
    await rename(temporary, designDir)
    return { designDir, manifest }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code === "EEXIST" || (error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
      throw new Error(`Design already exists: ${id}`, { cause: error })
    }
    throw error
  }
}
