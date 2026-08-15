import { lstat, readdir, readlink, rename, rm, symlink } from "node:fs/promises"
import path from "node:path"

const ARTIFACTS = ".artifacts"
const PUBLIC = ["step", "stl", "glb", "topo", "manifest.json"] as const
const GENERATION = /^[0-9a-f]{32}$/

export async function resolveArtifactGeneration(designDir: string): Promise<string | null> {
  const artifacts = path.join(designDir, ARTIFACTS)
  const current = path.join(artifacts, "current")
  try {
    const name = path.basename(await readlink(current))
    if (GENERATION.test(name) && (await lstat(path.join(artifacts, name))).isDirectory()) return name
  } catch {
    // current missing or dangling
  }
  let best: { name: string; mtime: number } | null = null
  let names: string[] = []
  try {
    names = await readdir(artifacts)
  } catch {
    return null
  }
  for (const name of names) {
    if (!GENERATION.test(name)) continue
    const dir = path.join(artifacts, name)
    const st = await lstat(dir).catch(() => null)
    if (!st?.isDirectory()) continue
    if (!(await lstat(path.join(dir, "manifest.json")).catch(() => null))) continue
    if (!best || st.mtimeMs > best.mtime) best = { name, mtime: st.mtimeMs }
  }
  return best?.name ?? null
}

async function replaceSymlink(linkPath: string, target: string) {
  try {
    if ((await readlink(linkPath)) === target) return
  } catch {
    // missing or not a symlink
  }
  const tmp = `${linkPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await rm(tmp, { force: true })
  await symlink(target, tmp)
  await rm(linkPath, { force: true })
  await rename(tmp, linkPath)
}

export async function ensurePublicArtifactLinks(designDir: string): Promise<string | null> {
  const generation = await resolveArtifactGeneration(designDir)
  if (!generation) return null
  await replaceSymlink(path.join(designDir, ARTIFACTS, "current"), generation)
  for (const name of PUBLIC) {
    await replaceSymlink(path.join(designDir, name), `${ARTIFACTS}/current/${name}`)
  }
  return generation
}
