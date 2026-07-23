import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { $ } from "bun"

export const REPO_ROOT = path.resolve(import.meta.dir, "../..")
export const REFERENCE_ROOT = path.join(REPO_ROOT, "reference-studio")
export const SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "opencode-studio.schema.json")

export type CheckResult = {
  name: string
  ok: boolean
  detail?: string
}

export async function tempDir(prefix: string) {
  return mkdtemp(path.join(tmpdir(), `osc-${prefix}-`))
}

export async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

export async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256")
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const relative = path.relative(root, full)
      if (entry.isDirectory()) {
        hash.update(`dir:${relative}\n`)
        await walk(full)
      } else if (entry.isFile()) {
        const content = await readFile(full)
        hash.update(`file:${relative}:${content.length}:`)
        hash.update(content)
        hash.update("\n")
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink:${relative}\n`)
      }
    }
  }
  await walk(root)
  return hash.digest("hex")
}

export function cliPath() {
  return path.join(REFERENCE_ROOT, "dist", "cli.js")
}

export async function runCli(args: string[], options: { env?: Record<string, string>; cwd?: string } = {}) {
  const proc = Bun.spawn(["bun", cliPath(), ...args], {
    cwd: options.cwd ?? REFERENCE_ROOT,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

let referenceBuilt = false

export async function ensureReferenceBuilt() {
  if (referenceBuilt) return
  await $`bun install`.cwd(REFERENCE_ROOT)
  await $`bun run build`.cwd(REFERENCE_ROOT)
  referenceBuilt = true
}

export async function packReference(destDir: string) {
  await ensureReferenceBuilt()
  await mkdir(destDir, { recursive: true })
  const result = await $`bun pm pack --destination ${destDir}`.cwd(REFERENCE_ROOT).text()
  const files = await readdir(destDir)
  const tarball = files.find((name) => name.endsWith(".tgz"))
  if (!tarball) throw new Error(`pack produced no tarball: ${result}`)
  return path.join(destDir, tarball)
}

export async function startCompanion(dataRoot: string, port: number) {
  const proc = Bun.spawn(
    [
      "bun",
      cliPath(),
      "serve",
      "--root",
      dataRoot,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--ui-directory",
      path.join(REFERENCE_ROOT, "dist", "ui"),
    ],
    {
      cwd: REFERENCE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 10_000
  let ready = false
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Companion exited early: ${stderr}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Host: `127.0.0.1:${port}` },
      })
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      // retry
    }
    await Bun.sleep(50)
  }

  if (!ready) {
    proc.kill("SIGTERM")
    await Promise.race([proc.exited, Bun.sleep(2000)])
    if (proc.exitCode === null) proc.kill("SIGKILL")
    throw new Error(`Companion did not become ready at ${baseUrl} within 10s`)
  }

  return {
    baseUrl,
    port,
    async stop() {
      proc.kill("SIGTERM")
      await Promise.race([proc.exited, Bun.sleep(2000)])
      if (proc.exitCode === null) proc.kill("SIGKILL")
    },
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export type StudioTarget = {
  root: string
  packageName: string
  packageVersion: string
  studioId: string
  contractVersion: string
  pluginManifestPath: string
  pluginSpecifier: string
  skillName: string
  skillRel: string
  cliEntry: string
  uiDist: string
  tokensPath: string
}

async function resolveCliEntry(root: string) {
  const distCli = path.join(root, "dist", "cli.js")
  if (await Bun.file(distCli).exists()) return distCli
  return path.join(root, "src", "cli.ts")
}

export async function loadStudioTarget(studioRoot: string): Promise<StudioTarget> {
  const root = path.resolve(studioRoot)
  const pkg = await readJson<{ name: string; version: string }>(path.join(root, "package.json"))
  const manifest = await readJson<{ id: string; contractVersion: string; plugin: string; skill: string }>(
    path.join(root, "opencode-studio.json"),
  )
  const pluginExport = manifest.plugin.replace(/^\.\//, "")
  const pluginSpecifier = pluginExport === "." || pluginExport === "" ? pkg.name : `${pkg.name}/${pluginExport}`
  const skillName = path.basename(path.normalize(manifest.skill))

  return {
    root,
    packageName: pkg.name,
    packageVersion: pkg.version,
    studioId: manifest.id,
    contractVersion: manifest.contractVersion,
    pluginManifestPath: manifest.plugin,
    pluginSpecifier,
    skillName,
    skillRel: manifest.skill,
    cliEntry: await resolveCliEntry(root),
    uiDist: path.join(root, "dist", "ui"),
    tokensPath: path.join(root, "ui", "src", "tokens.css"),
  }
}

const studiosBuilt = new Set<string>()

export async function ensureStudioBuilt(target: StudioTarget): Promise<void> {
  const distCli = path.join(target.root, "dist", "cli.js")
  if (await Bun.file(distCli).exists()) {
    target.cliEntry = distCli
    return
  }
  if (!studiosBuilt.has(target.root)) {
    await $`bun install`.cwd(target.root)
    await $`bun run build`.cwd(target.root)
    studiosBuilt.add(target.root)
  }
  if (await Bun.file(distCli).exists()) target.cliEntry = distCli
}

export async function runStudioCli(
  target: StudioTarget,
  args: string[],
  options: { env?: Record<string, string>; cwd?: string } = {},
) {
  const proc = Bun.spawn(["bun", target.cliEntry, ...args], {
    cwd: options.cwd ?? target.root,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

export async function startStudioCompanion(target: StudioTarget, dataRoot: string, port: number) {
  const args = ["serve", "--root", dataRoot, "--host", "127.0.0.1", "--port", String(port)]
  if (await Bun.file(path.join(target.uiDist, "index.html")).exists()) {
    args.push("--ui-directory", target.uiDist)
  }

  const proc = Bun.spawn(["bun", target.cliEntry, ...args], {
    cwd: target.root,
    stdout: "pipe",
    stderr: "pipe",
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15_000
  let ready = false
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Companion exited early: ${stderr}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Host: `127.0.0.1:${port}` },
      })
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      // retry
    }
    await Bun.sleep(50)
  }

  if (!ready) {
    proc.kill("SIGTERM")
    await Promise.race([proc.exited, Bun.sleep(2000)])
    if (proc.exitCode === null) proc.kill("SIGKILL")
    throw new Error(`Companion did not become ready at ${baseUrl} within 15s`)
  }

  return {
    baseUrl,
    port,
    async stop() {
      proc.kill("SIGTERM")
      await Promise.race([proc.exited, Bun.sleep(2000)])
      if (proc.exitCode === null) proc.kill("SIGKILL")
    },
  }
}

export async function packStudio(target: StudioTarget, destDir: string): Promise<string> {
  await mkdir(destDir, { recursive: true })
  const result = await $`bun pm pack --destination ${destDir}`.cwd(target.root).text()
  const files = await readdir(destDir)
  const tarball = files.find((name) => name.endsWith(".tgz"))
  if (!tarball) throw new Error(`pack produced no tarball: ${result}`)
  return path.join(destDir, tarball)
}
