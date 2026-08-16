import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { ensureUv } from "../../../src/core/engines"
import { syncCadEngineUvProject } from "../../../src/core/package-meta"
import { isInside } from "../../../src/core/paths"
import type { AcceptanceContract } from "./acceptance"
import { writeAcceptance } from "./acceptance"
import { resolveDesignDirectory, type StudioLayout } from "./library"
import { readArtifactManifest, readDesignManifest, scaffoldDesignManifest } from "./manifest"

/** Timed budget for a product build child. Host call ceiling is 210s. */
const CAD_BUILD_TIMEOUT_MS = 180_000
/** Grace period after SIGTERM before SIGKILL of the build process group. */
const CAD_BUILD_KILL_GRACE_MS = 2_000

export type CadBuildResult = {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  manifestPath: string | null
  designDir: string
}

export type CadBuildRunner = (input: {
  engineProjectDir: string
  designDir: string
  cwd: string
  sessionID?: string
  signal?: AbortSignal
}) => Promise<CadBuildResult>

/**
 * Build in a killable child process (studio-cad-build CLI). Abort kills the
 * process group and returns only after it exits; a killed build cannot
 * publish, and the warm execute session is untouched.
 */
export function createCadBuildRunner(cwd: string): CadBuildRunner {
  return async ({ engineProjectDir, designDir, signal }) => {
    const uv = await ensureUv()
    // Keep the uv sync inside the build's host-call budget: cap it well below
    // the child timeout so the plan's 180s child < 210s host ordering holds
    // even on a cold cache.
    await syncCadEngineUvProject(uv.path, engineProjectDir, { signal, timeoutMs: 30_000 })
    const args = [uv.path, "--project", engineProjectDir, "run", "--no-sync", "studio-cad-build", "build", designDir]
    const child = spawn(args[0]!, args.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk))
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk))

    const killGroup = (signalType: NodeJS.Signals) => {
      if (!child.pid) return
      try {
        process.kill(-child.pid, signalType)
      } catch {
        try {
          child.kill(signalType)
        } catch {
          /* already gone */
        }
      }
    }

    const timedOut = new Promise<never>((_, reject) => {
      setTimeout(() => {
        killGroup("SIGTERM")
        setTimeout(() => killGroup("SIGKILL"), CAD_BUILD_KILL_GRACE_MS).unref()
        reject(new Error(`cad build timed out after ${CAD_BUILD_TIMEOUT_MS}ms`))
      }, CAD_BUILD_TIMEOUT_MS).unref()
    })
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => {
        killGroup("SIGTERM")
        setTimeout(() => killGroup("SIGKILL"), CAD_BUILD_KILL_GRACE_MS).unref()
        reject(new Error("cad build aborted"))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener("abort", onAbort, { once: true })
    })
    const exited = new Promise<number>((resolve) => child.once("exit", (code) => resolve(code ?? -1)))
    const spawnError = new Promise<never>((_, reject) => child.once("error", (error) => reject(error)))
    let exitCode: number
    try {
      exitCode = await Promise.race([exited, timedOut, aborted, spawnError])
    } catch (error) {
      // Spawn failure or abort: wait for the child to actually exit, but never
      // hang on it — a failed spawn emits no exit event.
      if (!child.exitCode && !child.signalCode) {
        killGroup("SIGTERM")
        setTimeout(() => killGroup("SIGKILL"), CAD_BUILD_KILL_GRACE_MS).unref()
      }
      exitCode = await Promise.race([exited.catch(() => -1), new Promise<number>((resolve) => setTimeout(() => resolve(-1), CAD_BUILD_KILL_GRACE_MS))])
      return {
        ok: false,
        exitCode: signal?.aborted ? 130 : 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: `${Buffer.concat(stderrChunks).toString("utf8")}\n${error instanceof Error ? error.message : String(error)}`,
        manifestPath: null,
        designDir,
      }
    }
    const stdout = Buffer.concat(stdoutChunks).toString("utf8")
    const stderr = Buffer.concat(stderrChunks).toString("utf8")
    return {
      ok: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      manifestPath: null,
      designDir,
    }
  }
}

export const defaultCadBuildRunner: CadBuildRunner = createCadBuildRunner(process.cwd())

export async function buildDesign(
  layout: StudioLayout,
  id: string,
  engineProjectDir: string,
  runner: CadBuildRunner = defaultCadBuildRunner,
  signal?: AbortSignal,
  cwd: string = process.cwd(),
  sessionID?: string,
): Promise<CadBuildResult & { manifestPath: string | null }> {
  const designDir = await resolveDesignDirectory(layout, id)
  const design = await readDesignManifest(designDir, id)
  const result = await runner({ engineProjectDir, designDir, cwd, sessionID, signal })
  if (!result.ok) return { ...result, manifestPath: null }
  const artifact = await readArtifactManifest(designDir, id)
  if (!artifact) {
    return {
      ...result,
      ok: false,
      exitCode: 1,
      stderr: `${result.stderr}\nBuild exited successfully but manifest.json is missing`,
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
  // Artifact manifest inputs must match the allowlisted design inputs.
  const expectedInputs = new Set<string>(
    ["design.json", design.params ? (design.params as string) : undefined, ...design.parts.map((part) => part.source)].filter(
      (name): name is string => Boolean(name),
    ),
  )
  const actualInputs = new Set(Object.keys(artifact.build.inputs))
  for (const name of expectedInputs) {
    if (!actualInputs.has(name)) {
      return {
        ...result,
        ok: false,
        exitCode: 1,
        stderr: `${result.stderr}\nBuild input missing from manifest: ${name}`,
        manifestPath: null,
      }
    }
  }
  for (const name of actualInputs) {
    if (!expectedInputs.has(name)) {
      return {
        ...result,
        ok: false,
        exitCode: 1,
        stderr: `${result.stderr}\nBuild manifest includes non-allowlisted input: ${name}`,
        manifestPath: null,
      }
    }
  }
  return { ...result, manifestPath: path.join(designDir, "manifest.json") }
}

export async function scaffoldDesign(
  layout: StudioLayout,
  id: string,
  parts: Array<{ id: string; source?: string; qty?: 1 | 2 }>,
  acceptance: AcceptanceContract,
): Promise<{ designDir: string; manifest: ReturnType<typeof scaffoldDesignManifest>; acceptanceFile: string }> {
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
    // Acceptance locks first; sources scaffold only after that commit.
    await writeAcceptance(temporary, acceptance)
    const acceptanceFile = path.join(temporary, "acceptance.json")
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
        `"""Parametric source for ${part.id}."""\n\ndef build():\n    raise NotImplementedError("Model ${part.id} before cad_design_build")\n`,
        { encoding: "utf8", flag: "wx" },
      )
    }
    await rename(temporary, designDir)
    return { designDir, manifest, acceptanceFile }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code === "EEXIST" || (error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
      throw new Error(`Design already exists: ${id}`, { cause: error })
    }
    throw error
  }
}
