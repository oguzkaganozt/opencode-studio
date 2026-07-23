import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { chmod, link, lstat, mkdir, open, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { isInside } from "../../src/core/paths"

export { isInside }

export type AskPermission = (input: {
  permission: string
  patterns: string[]
  always: string[]
  metadata: Record<string, unknown>
}) => Promise<void>

export async function canonicalStudioRoot(directory: string) {
  return realpath(directory)
}

export function resolveStudioPath(root: string, input: string) {
  const candidate = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input)
  if (!isInside(root, candidate)) throw new Error(`Path must be inside the Studio root: ${input}`)
  return candidate
}

export async function validateStudioDirectory(root: string, input: string) {
  if (path.isAbsolute(input)) throw new Error(`Directory must be relative to the Studio root: ${input}`)
  const directory = resolveStudioPath(root, input)
  const relative = path.relative(root, directory)
  if (!relative) throw new Error("Directory must name a subdirectory inside the Studio root")

  let current = root
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe media directory: ${current}`)
      const canonical = await realpath(current)
      if (!isInside(root, canonical)) throw new Error(`Media directory resolves outside the Studio root: ${input}`)
      current = canonical
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break
      throw error
    }
  }
  return relative
}

async function ensureSafeDirectory(root: string, directory: string) {
  const relative = path.relative(root, directory)
  let current = root
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe output directory: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      try {
        await mkdir(current, { mode: 0o2770 })
        await chmod(current, 0o2770)
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError
      }
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe output directory: ${current}`)
    }
    const canonical = await realpath(current)
    if (!isInside(root, canonical)) throw new Error(`Output directory resolves outside the Studio root: ${directory}`)
    current = canonical
  }
  return current
}

export async function prepareNewOutput(input: { root: string; outputPath: string; ask: AskPermission }) {
  const requested = resolveStudioPath(input.root, input.outputPath)
  const relative = path.relative(input.root, requested)
  if (!relative || path.basename(requested) === "." || path.basename(requested) === "..") {
    throw new Error(`Output path must name a file: ${input.outputPath}`)
  }

  await input.ask({ permission: "edit", patterns: [relative], always: [], metadata: {} })
  const parent = await ensureSafeDirectory(input.root, path.dirname(requested))
  const outputPath = path.join(parent, path.basename(requested))
  try {
    await lstat(outputPath)
    throw new Error(`Output file already exists: ${relative}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return { outputPath, relativePath: path.relative(input.root, outputPath) }
}

export async function writeNewFileAtomic(outputPath: string, bytes: Uint8Array) {
  const parent = path.dirname(outputPath)
  const temporary = path.join(parent, `.${path.basename(outputPath)}.${randomUUID()}.tmp`)
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try {
    try {
      await handle.chmod(0o660)
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, outputPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Output file already exists: ${outputPath}`)
      }
      throw error
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function verifyOutputParent(root: string, outputPath: string) {
  const parent = path.dirname(outputPath)
  const canonical = await realpath(parent)
  if (canonical !== parent || !isInside(root, canonical)) {
    throw new Error(`Output directory is no longer safe: ${parent}`)
  }
}

export async function verifyNewOutput(root: string, outputPath: string) {
  await verifyOutputParent(root, outputPath)
  try {
    await lstat(outputPath)
    throw new Error(`Output file already exists: ${outputPath}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

export async function readSecureFile(input: { root: string; filePath: string; maxBytes: number; signal: AbortSignal; ask: AskPermission }) {
  const requested = path.isAbsolute(input.filePath) ? path.normalize(input.filePath) : path.resolve(input.root, input.filePath)
  const filePath = await realpath(requested)
  const relative = path.relative(input.root, filePath)
  if (!isInside(input.root, filePath)) {
    await input.ask({ permission: "external_directory", patterns: [filePath], always: [], metadata: {} })
  }
  await input.ask({
    permission: "read",
    patterns: [isInside(input.root, filePath) ? relative || path.basename(filePath) : filePath],
    always: ["*"],
    metadata: {},
  })

  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error(`Not a file: ${filePath}`)
    if (info.size === 0) throw new Error(`File is empty: ${filePath}`)
    if (info.size > input.maxBytes) throw new Error(`File exceeds ${input.maxBytes} bytes: ${filePath}`)

    const bytes = Buffer.allocUnsafe(info.size)
    let offset = 0
    while (offset < bytes.length) {
      if (input.signal.aborted) throw input.signal.reason ?? new Error("File read aborted")
      const result = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    return { filePath, bytes: bytes.subarray(0, offset) }
  } finally {
    await handle.close()
  }
}
