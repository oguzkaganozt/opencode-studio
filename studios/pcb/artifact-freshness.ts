import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const STAMP_VERSION = 1
const STAMP_PATH = path.join("dist", ".pcb-build-inputs.json")
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".venv", "__pycache__", ".pytest_cache"])
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])
const ROOT_CONFIG_RE =
  /^(?:package(?:-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^.]+)?\.json|[^/]+\.config\.(?:ts|tsx|js|jsx|mjs|cjs))$/

export type ArtifactFreshness = { fresh: boolean; reason: "fresh" | "missing_stamp" | "invalid_stamp" | "inputs_changed" }

function isBuildInput(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/")
  const extension = path.extname(normalized).toLowerCase()
  return normalized.startsWith("src/") || SOURCE_EXTENSIONS.has(extension) || (!normalized.includes("/") && ROOT_CONFIG_RE.test(normalized))
}

async function collectBuildInputs(projectDir: string, dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const absolutePath = path.join(dir, entry.name)
    const relativePath = path.relative(projectDir, absolutePath)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collectBuildInputs(projectDir, absolutePath, files)
    } else if (entry.isFile() && isBuildInput(relativePath)) {
      files.push(relativePath)
    }
  }
}

export async function buildInputDigest(projectDir: string): Promise<string> {
  const root = path.resolve(projectDir)
  const files: string[] = []
  await collectBuildInputs(root, root, files)
  const hash = createHash("sha256")
  for (const relativePath of files) {
    const content = await readFile(path.join(root, relativePath))
    hash.update(relativePath.split(path.sep).join("/"))
    hash.update("\0")
    hash.update(content)
    hash.update("\0")
  }
  return hash.digest("hex")
}

export async function clearBuildInputStamp(projectDir: string): Promise<void> {
  await rm(path.join(projectDir, STAMP_PATH), { force: true })
}

export async function writeBuildInputStamp(projectDir: string, digest: string): Promise<void> {
  const stampPath = path.join(projectDir, STAMP_PATH)
  const temporaryPath = `${stampPath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(path.dirname(stampPath), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify({ version: STAMP_VERSION, digest })}\n`)
  await rename(temporaryPath, stampPath)
}

export async function artifactFreshness(projectDir: string): Promise<ArtifactFreshness> {
  let stamp: unknown
  try {
    const stampPath = path.join(projectDir, STAMP_PATH)
    const info = await lstat(stampPath)
    if (!info.isFile() || info.isSymbolicLink()) return { fresh: false, reason: "invalid_stamp" }
    stamp = JSON.parse(await readFile(stampPath, "utf8"))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { fresh: false, reason: "missing_stamp" }
      : { fresh: false, reason: "invalid_stamp" }
  }
  if (
    !stamp ||
    typeof stamp !== "object" ||
    (stamp as Record<string, unknown>).version !== STAMP_VERSION ||
    typeof (stamp as Record<string, unknown>).digest !== "string"
  ) {
    return { fresh: false, reason: "invalid_stamp" }
  }
  return (stamp as { digest: string }).digest === (await buildInputDigest(projectDir))
    ? { fresh: true, reason: "fresh" }
    : { fresh: false, reason: "inputs_changed" }
}

export function staleArtifactMessage(reason: ArtifactFreshness["reason"]): string {
  return reason === "missing_stamp"
    ? "Build freshness metadata is missing. Run pcb_circuit_build again."
    : reason === "invalid_stamp"
      ? "Build freshness metadata is invalid. Run pcb_circuit_build again."
      : "Project source or build configuration changed after the last build. Run pcb_circuit_build again."
}
