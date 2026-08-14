import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../../src/core/paths"
import { getCadRuntimeSession } from "../tools/session"
import { resolveDesignDirectory, type StudioLayout } from "./library"
import { readArtifactManifest, readDesignManifest, scaffoldDesignManifest } from "./manifest"

/** Timed budget for product build via the shared CAD runtime session. */
const CAD_BUILD_TIMEOUT_MS = 120_000

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
 * Build through the same studio-cad-runtime session as cad_execute / measure / …
 * (single agent-facing runtime; cad_build runs in-process inside that runtime).
 */
export function createCadBuildRunner(cwd: string): CadBuildRunner {
  return async ({ engineProjectDir, designDir, sessionID, signal }) => {
    const session = getCadRuntimeSession(engineProjectDir, cwd, sessionID)
    try {
      const result = await session.callTool(
        "studio_build",
        { design_dir: designDir },
        {
          signal,
          timeoutMs: CAD_BUILD_TIMEOUT_MS,
          // Build shares the CAD process; do not wipe interactive session state on timeout/cancel.
          resetSessionOnFailure: false,
        },
      )
      if (result.isError) {
        return {
          ok: false,
          exitCode: signal?.aborted ? 130 : 1,
          stdout: "",
          stderr: result.text || "studio_build failed",
          manifestPath: null,
          designDir,
        }
      }
      let parsed: {
        ok?: boolean
        exitCode?: number
        stdout?: string
        stderr?: string
        manifestPath?: string | null
        designDir?: string
      }
      try {
        parsed = JSON.parse(result.text) as typeof parsed
      } catch {
        return {
          ok: false,
          exitCode: 1,
          stdout: result.text,
          stderr: "studio_build returned non-JSON output",
          manifestPath: null,
          designDir,
        }
      }
      return {
        ok: parsed.ok === true,
        exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : parsed.ok ? 0 : 1,
        stdout: typeof parsed.stdout === "string" ? parsed.stdout : "",
        stderr: typeof parsed.stderr === "string" ? parsed.stderr : "",
        manifestPath: typeof parsed.manifestPath === "string" ? parsed.manifestPath : null,
        designDir: typeof parsed.designDir === "string" ? parsed.designDir : designDir,
      }
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
  await readDesignManifest(designDir, id)
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
        `"""Parametric source for ${part.id}."""\n\ndef build():\n    raise NotImplementedError("Model ${part.id} before cad_design_build")\n`,
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
