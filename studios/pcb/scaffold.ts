import { randomUUID } from "node:crypto"
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { isInside } from "./studio-path"
import { basicProjectTemplate } from "./templates"

export type ScaffoldResult = {
  name: string
  relativePath: string
  absolutePath: string
  files: string[]
}

export type InstallResult = {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function validateProjectName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid project name '${name}'. Use lowercase letters, digits, and dashes (e.g. 'motor-driver-rev-a').`)
  }
}

/**
 * Write a minimal tscircuit project into the workspace.
 * Stages into a temp directory then renames onto the target (atomic when target is new).
 */
export async function scaffoldProject(workspaceRoot: string, name: string, directory?: string): Promise<ScaffoldResult> {
  validateProjectName(name)
  const relative = directory?.trim() ? directory.trim() : name
  if (path.isAbsolute(relative)) throw new Error("directory must be relative to the workspace root")
  const target = path.resolve(workspaceRoot, relative)
  if (!isInside(workspaceRoot, target)) throw new Error(`Directory escapes workspace root: ${relative}`)

  try {
    const entries = await readdir(target)
    if (entries.length > 0) throw new Error(`Directory already exists and is not empty: ${relative}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const files = basicProjectTemplate(name)
  const staging = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
  try {
    for (const [relativeFile, content] of Object.entries(files)) {
      const filePath = path.join(staging, relativeFile)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, content, "utf8")
    }
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await rename(staging, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY" || (error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Directory already exists and is not empty: ${relative}`)
      }
      // If target exists empty, remove and retry once
      try {
        const entries = await readdir(target)
        if (entries.length === 0) {
          await rm(target, { recursive: true, force: true })
          await rename(staging, target)
        } else {
          throw error
        }
      } catch (inner) {
        if (inner === error) throw error
        throw inner
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }

  return {
    name,
    relativePath: path.relative(workspaceRoot, target),
    absolutePath: target,
    files: Object.keys(files),
  }
}

/**
 * Run `npm install` in a freshly scaffolded project so tsci can run locally.
 */
export async function installProjectDeps(projectDir: string, signal?: AbortSignal): Promise<InstallResult> {
  const proc = Bun.spawn(["npm", "install", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: projectDir,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    signal,
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { success: exitCode === 0, stdout, stderr, exitCode }
}
