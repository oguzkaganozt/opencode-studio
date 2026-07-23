import { constants } from "node:fs"
import { chmod, lstat, mkdir, open, opendir, realpath } from "node:fs/promises"
import { homedir, userInfo } from "node:os"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import { isInside } from "../../src/core/paths"
import { modalityFromMime } from "./assets"
import type { AskPermission } from "./studio-path"

export function defaultLibraryRoot(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const xdg = env.XDG_DATA_HOME
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "opencode-studio", "media")
  return path.join(home, ".local", "share", "opencode-studio", "media")
}

/** @deprecated Prefer defaultLibraryRoot(); kept for tests that override root explicitly. */
export const DEFAULT_LIBRARY_ROOT = defaultLibraryRoot()
export const LIBRARY_SCAN_LIMIT = 10_000
export const LIBRARY_MAX_FOLDER_DEPTH = 3
export type LibraryModality = "image" | "audio" | "video"
export type LibraryScope = "personal" | "shared"

const DIRECTORY_BY_MODALITY: Record<LibraryModality, string> = {
  image: "images",
  audio: "audio",
  video: "video",
}

export type LibraryLayout = {
  root: string
  username: string
  personal: Record<LibraryModality, string>
  shared: Record<LibraryModality, string>
}

export type ManagedAsset = {
  filePath: string
  scope: LibraryScope
  user?: string
  modality: LibraryModality
  mime: string
  bytes: number
  modifiedAt: string
}

export type FolderEntry = {
  folderPath: string
  scope: LibraryScope
  user?: string
  modality: LibraryModality
  name: string
  subfolder: string
}

export type FolderScanResult = {
  assets: ManagedAsset[]
  folders: FolderEntry[]
}

const FOLDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function validateFolderName(name: string) {
  if (!FOLDER_NAME_PATTERN.test(name)) throw new Error(`Invalid folder name: ${name}`)
  return name
}

export function validateSubfolderPath(subfolder: string | undefined) {
  if (!subfolder) return ""
  const parts = subfolder.split(path.sep).filter(Boolean)
  if (parts.length === 0) return ""
  if (parts.length > LIBRARY_MAX_FOLDER_DEPTH) throw new Error(`Subfolder depth exceeds ${LIBRARY_MAX_FOLDER_DEPTH}`)
  for (const part of parts) {
    if (part === "." || part === "..") throw new Error(`Invalid subfolder component: ${part}`)
    validateFolderName(part)
  }
  return parts.join(path.sep)
}

export function validLibraryUser(username: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username)
}

export function validateLibraryUser(username: string) {
  if (!validLibraryUser(username)) throw new Error(`Invalid Library user: ${username}`)
  return username
}

export function currentUnixUsername(resolveUsername?: (uid: number) => string) {
  if (typeof process.getuid !== "function") throw new Error("opencode-media-studio: process UID is unavailable")
  const uid = process.getuid()
  const account = resolveUsername === undefined ? userInfo() : undefined
  if (account && account.uid !== uid) throw new Error(`opencode-media-studio: Unix account does not match process UID ${uid}`)
  const username = account?.username ?? resolveUsername!(uid)
  if (!validLibraryUser(username)) throw new Error(`opencode-media-studio: invalid Unix username for UID ${uid}`)
  return username
}

async function ensureDirectory(directory: string) {
  let created = false
  try {
    await mkdir(directory, { mode: 0o2770 })
    created = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  const info = await lstat(directory)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe Library directory: ${directory}`)
  if (created) {
    await chmod(directory, 0o770)
    // Bun currently strips setgid from fs.chmod, so use the direct system utility without a shell.
    const process = Bun.spawn(["chmod", "2770", directory], { stdout: "ignore", stderr: "pipe" })
    const exitCode = await process.exited
    if (exitCode !== 0) throw new Error(`Could not set shared Library directory permissions: ${directory}`)
  }
}

async function setGroupDirectoryMode(directory: string) {
  await chmod(directory, 0o770)
  // Bun currently strips setgid from fs.chmod, so use the direct system utility without a shell.
  const process = Bun.spawn(["chmod", "2770", directory], { stdout: "ignore", stderr: "pipe" })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`Could not set shared Library directory permissions: ${directory}`)
}

async function canonicalLibraryRoot(root: string) {
  const requested = path.resolve(root)
  const info = await lstat(requested)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe Library directory: ${requested}`)
  const canonical = await realpath(requested)
  if (canonical !== requested) throw new Error(`Library root must not contain symlinks: ${requested}`)
  return canonical
}

async function ensureLibraryChild(root: string, directory: string) {
  if (!isInside(root, directory) || directory === root) throw new Error(`Unsafe Library directory: ${directory}`)
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || (await realpath(root)) !== root) {
    throw new Error(`Unsafe Library directory: ${root}`)
  }
  const relative = path.relative(root, directory)
  let current = root
  for (const component of relative.split(path.sep)) {
    if (!component) continue
    current = path.join(current, component)
    try {
      await mkdir(current, { mode: 0o2770 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    const info = await lstat(current)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe Library directory: ${current}`)
    const canonical = await realpath(current)
    if (canonical !== current || !isInside(root, canonical))
      throw new Error(`Library directory resolves outside the Library root: ${current}`)
    if ((info.mode & 0o2770) !== 0o2770) await setGroupDirectoryMode(current)
  }
  return directory
}

export async function ensurePersonalLibraryLayout(root: string, username: string) {
  validateLibraryUser(username)
  const canonicalRoot = await canonicalLibraryRoot(root)
  const personalRoot = await ensureLibraryChild(canonicalRoot, path.join(canonicalRoot, "users", username))
  const personal = {} as Record<LibraryModality, string>
  for (const modality of ["image", "audio", "video"] as const) {
    personal[modality] = await ensureLibraryChild(personalRoot, path.join(personalRoot, DIRECTORY_BY_MODALITY[modality]))
  }
  return personal
}

export async function ensureSharedLibraryLayout(root: string) {
  const canonicalRoot = await canonicalLibraryRoot(root)
  const sharedRoot = await ensureLibraryChild(canonicalRoot, path.join(canonicalRoot, "shared"))
  const shared = {} as Record<LibraryModality, string>
  for (const modality of ["image", "audio", "video"] as const) {
    shared[modality] = await ensureLibraryChild(sharedRoot, path.join(sharedRoot, DIRECTORY_BY_MODALITY[modality]))
  }
  return shared
}

export async function resolveManagedDirectory(input: {
  root: string
  scope: LibraryScope
  modality: LibraryModality
  user?: string
  subfolder?: string
}) {
  let baseDir: string
  if (input.scope === "personal") {
    if (!input.user) throw new Error("A personal Library directory requires a user")
    baseDir = (await ensurePersonalLibraryLayout(input.root, input.user))[input.modality]
  } else {
    if (input.user !== undefined) throw new Error("A shared Library directory cannot include a user")
    baseDir = (await ensureSharedLibraryLayout(input.root))[input.modality]
  }
  const subfolder = validateSubfolderPath(input.subfolder)
  if (!subfolder) return baseDir
  return ensureLibraryChild(baseDir, path.join(baseDir, subfolder))
}

export async function resolveExistingLibraryRoot(input: { root: string }): Promise<string> {
  const requestedRoot = path.resolve(input.root)
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(requestedRoot)
  } catch {
    throw new Error(`Library root does not exist: ${requestedRoot}`)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe Library directory: ${requestedRoot}`)
  const root = await realpath(requestedRoot)
  if (root !== requestedRoot) throw new Error(`Library root must not contain symlinks: ${requestedRoot}`)
  return root
}

export async function initializeLibrary(input: { root?: string; resolveUsername?: (uid: number) => string }): Promise<LibraryLayout> {
  const requestedRoot = path.resolve(input.root ?? DEFAULT_LIBRARY_ROOT)
  await ensureDirectory(requestedRoot)
  const root = await realpath(requestedRoot)
  if (root !== requestedRoot) throw new Error(`Library root must not contain symlinks: ${requestedRoot}`)
  const username = currentUnixUsername(input.resolveUsername)
  const users = path.join(root, "users")
  const personalRoot = path.join(users, username)
  const sharedRoot = path.join(root, "shared")
  for (const directory of [users, personalRoot, sharedRoot]) await ensureDirectory(directory)

  const personal = {} as Record<LibraryModality, string>
  const shared = {} as Record<LibraryModality, string>
  for (const modality of ["image", "audio", "video"] as const) {
    personal[modality] = path.join(personalRoot, DIRECTORY_BY_MODALITY[modality])
    shared[modality] = path.join(sharedRoot, DIRECTORY_BY_MODALITY[modality])
    await ensureDirectory(personal[modality])
    await ensureDirectory(shared[modality])
  }
  return { root, username, personal, shared }
}

export function classifyManagedPath(root: string, filePath: string) {
  const relativePath = path.relative(root, filePath)
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return
  const parts = relativePath.split(path.sep)
  let scope: LibraryScope
  let user: string | undefined
  let modalityDir: string
  let filename: string
  let subfolder: string | undefined

  if (parts.length >= 4 && parts[0] === "users" && validLibraryUser(parts[1]!)) {
    scope = "personal"
    user = parts[1]
    modalityDir = parts[2]!
    if (parts.length === 4) {
      filename = parts[3]!
    } else {
      subfolder = parts.slice(3, -1).join(path.sep)
      filename = parts[parts.length - 1]!
    }
  } else if (parts.length >= 3 && parts[0] === "shared") {
    scope = "shared"
    modalityDir = parts[1]!
    if (parts.length === 3) {
      filename = parts[2]!
    } else {
      subfolder = parts.slice(2, -1).join(path.sep)
      filename = parts[parts.length - 1]!
    }
  } else {
    return
  }

  if (!filename || filename === "." || filename === "..") return
  const modality = (Object.entries(DIRECTORY_BY_MODALITY).find(([, value]) => value === modalityDir)?.[0] ?? undefined) as
    | LibraryModality
    | undefined
  if (!modality) return

  const maxParts = scope === "personal" ? 4 + LIBRARY_MAX_FOLDER_DEPTH : 3 + LIBRARY_MAX_FOLDER_DEPTH
  if (parts.length > maxParts) return

  if (subfolder) {
    for (const component of subfolder.split(path.sep)) {
      if (component === "." || component === ".." || !FOLDER_NAME_PATTERN.test(component)) return
    }
  }

  return { relativePath, scope, user, modality, subfolder }
}

export async function resolveManagedPath(root: string, input: string) {
  const requested = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input)
  const classification = classifyManagedPath(root, requested)
  if (!classification) throw new Error(`Path is not a managed Library asset: ${input}`)
  const info = await lstat(requested)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Path is not a regular managed Library asset: ${input}`)
  const canonical = await realpath(requested)
  if (canonical !== requested) throw new Error(`Managed Library asset must not use symlinks: ${input}`)
  return { filePath: canonical, ...classification }
}

export function personalOutputPath(layout: LibraryLayout, modality: LibraryModality, requested: string | undefined, filename: string) {
  const directory = layout.personal[modality]
  const outputPath = requested
    ? path.isAbsolute(requested)
      ? path.normalize(requested)
      : requested.includes(path.sep)
        ? path.resolve(layout.root, requested)
        : path.join(directory, requested)
    : path.join(directory, filename)
  if (path.dirname(outputPath) !== directory) {
    throw new Error(`Output path must be directly inside the current user's ${DIRECTORY_BY_MODALITY[modality]} directory`)
  }
  return outputPath
}

async function inspectManagedPath(root: string, filePath: string): Promise<ManagedAsset> {
  const managed = await resolveManagedPath(root, filePath)
  const handle = await open(managed.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    const header = Buffer.alloc(Math.min(info.size, 64 * 1024))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
    const detectedModality = detected ? modalityFromMime(detected.mime) : undefined
    if (!detected || !detectedModality) throw new Error(`Unsupported media file: ${managed.filePath}`)
    if (detectedModality !== managed.modality)
      throw new Error(`Media content is in the wrong Library modality directory: ${managed.filePath}`)
    return {
      filePath: managed.filePath,
      scope: managed.scope,
      user: managed.user,
      modality: managed.modality,
      mime: detected.mime,
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    }
  } finally {
    await handle.close()
  }
}

export async function inspectManagedAsset(root: string, filePath: string) {
  return inspectManagedPath(root, filePath)
}

export async function openManagedAsset(input: {
  root: string
  workspaceRoot: string
  filePath: string
  signal: AbortSignal
  ask: AskPermission
}) {
  const managed = await resolveManagedPath(input.root, input.filePath)
  if (!managed.filePath.startsWith(`${input.workspaceRoot}${path.sep}`) && managed.filePath !== input.workspaceRoot) {
    await input.ask({ permission: "external_directory", patterns: [managed.filePath], always: [], metadata: {} })
  }
  await input.ask({ permission: "read", patterns: [managed.filePath], always: ["*"], metadata: {} })
  input.signal.throwIfAborted()
  const handle = await open(managed.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size === 0) throw new Error(`Managed Library asset is empty: ${managed.filePath}`)
    const header = Buffer.alloc(Math.min(info.size, 64 * 1024))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
    const detectedModality = detected ? modalityFromMime(detected.mime) : undefined
    if (!detected || detectedModality !== managed.modality) {
      throw new Error(`Media content does not match its Library modality directory: ${managed.filePath}`)
    }
    return { ...managed, bytes: info.size, mime: detected.mime, extension: detected.ext, handle }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function scanDirectoryRecursive(
  directory: string,
  depth: number,
  maxDepth: number,
  filename: string | undefined,
  candidates: string[],
  scanned: number,
  scanLimit: number,
): Promise<number> {
  if (depth > maxDepth) return scanned
  try {
    const opened = await opendir(directory)
    for await (const entry of opened) {
      scanned += 1
      if (scanned > scanLimit) throw new Error(`Library scan exceeds ${scanLimit} entries; narrow the filters`)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        scanned = await scanDirectoryRecursive(
          path.join(directory, entry.name),
          depth + 1,
          maxDepth,
          filename,
          candidates,
          scanned,
          scanLimit,
        )
      } else if (entry.isFile()) {
        if (filename && !entry.name.toLocaleLowerCase("en-US").includes(filename.toLocaleLowerCase("en-US"))) continue
        candidates.push(path.join(directory, entry.name))
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return scanned
    throw error
  }
  return scanned
}

export async function scanLibrary(input: {
  root: string
  user?: string
  scope?: LibraryScope
  modality?: LibraryModality
  filename?: string
  limit: number
  offset: number
  scanLimit?: number
}) {
  if (input.user !== undefined && !validLibraryUser(input.user)) throw new Error(`Invalid Library user filter: ${input.user}`)
  const directories: string[] = []
  const modalities = input.modality ? [input.modality] : (["image", "audio", "video"] as const)
  const scanLimit = input.scanLimit ?? LIBRARY_SCAN_LIMIT
  let scanned = 0
  if (input.scope !== "shared") {
    const usersRoot = path.join(input.root, "users")
    const users: string[] = []
    if (input.user) users.push(input.user)
    else {
      try {
        const directory = await opendir(usersRoot)
        for await (const entry of directory) {
          scanned += 1
          if (scanned > scanLimit) throw new Error(`Library scan exceeds ${scanLimit} entries; narrow the filters`)
          if (entry.isDirectory() && !entry.isSymbolicLink() && validLibraryUser(entry.name)) users.push(entry.name)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      users.sort()
    }
    for (const user of users)
      for (const modality of modalities) directories.push(path.join(usersRoot, user, DIRECTORY_BY_MODALITY[modality]))
  }
  // Shared is included for scope=shared, or combined listings (no scope). A personal user
  // filter still allows shared so "my library + shared" remains the default companion view.
  if (input.scope !== "personal") {
    for (const modality of modalities) directories.push(path.join(input.root, "shared", DIRECTORY_BY_MODALITY[modality]))
  }

  const candidates: string[] = []
  for (const directory of directories) {
    scanned = await scanDirectoryRecursive(directory, 0, LIBRARY_MAX_FOLDER_DEPTH, input.filename, candidates, scanned, scanLimit)
  }
  candidates.sort((left, right) => path.relative(input.root, left).localeCompare(path.relative(input.root, right), "en-US"))
  const assets: ManagedAsset[] = []
  for (const candidate of candidates) {
    try {
      assets.push(await inspectManagedPath(input.root, candidate))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const message = error instanceof Error ? error.message : ""
        if (!message.startsWith("Unsupported media file") && !message.startsWith("Media content is in the wrong")) throw error
      }
    }
  }
  return assets.slice(input.offset, input.offset + input.limit)
}

export async function scanFolderContents(input: {
  root: string
  scope: LibraryScope
  modality: LibraryModality
  user?: string
  subfolder?: string
  filename?: string
  limit: number
  offset: number
}): Promise<FolderScanResult> {
  const baseDir = await resolveManagedDirectory({
    root: input.root,
    scope: input.scope,
    modality: input.modality,
    user: input.user,
    subfolder: input.subfolder,
  })

  const folders: FolderEntry[] = []
  const fileCandidates: string[] = []
  try {
    const opened = await opendir(baseDir)
    for await (const entry of opened) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        const subfolderPath = input.subfolder ? path.join(input.subfolder, entry.name) : entry.name
        if (subfolderPath.split(path.sep).length > LIBRARY_MAX_FOLDER_DEPTH) continue
        if (!FOLDER_NAME_PATTERN.test(entry.name)) continue
        folders.push({
          folderPath: path.join(baseDir, entry.name),
          scope: input.scope,
          user: input.user,
          modality: input.modality,
          name: entry.name,
          subfolder: subfolderPath,
        })
      } else if (entry.isFile()) {
        if (input.filename && !entry.name.toLocaleLowerCase("en-US").includes(input.filename.toLocaleLowerCase("en-US"))) continue
        fileCandidates.push(path.join(baseDir, entry.name))
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  folders.sort((left, right) => left.name.localeCompare(right.name, "en-US"))
  fileCandidates.sort((left, right) => left.localeCompare(right, "en-US"))

  const assets: ManagedAsset[] = []
  for (const candidate of fileCandidates) {
    try {
      assets.push(await inspectManagedPath(input.root, candidate))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const message = error instanceof Error ? error.message : ""
        if (!message.startsWith("Unsupported media file") && !message.startsWith("Media content is in the wrong")) throw error
      }
    }
  }

  const start = input.offset
  const end = start + input.limit
  return {
    assets: assets.slice(start, end),
    folders: folders.slice(start, end),
  }
}

export async function createManagedFolder(input: {
  root: string
  scope: LibraryScope
  modality: LibraryModality
  user?: string
  parent?: string
  name: string
}) {
  validateFolderName(input.name)
  const parentSubfolder = validateSubfolderPath(input.parent)
  const newSubfolder = parentSubfolder ? path.join(parentSubfolder, input.name) : input.name
  if (newSubfolder.split(path.sep).length > LIBRARY_MAX_FOLDER_DEPTH) {
    throw new Error(`Subfolder depth exceeds ${LIBRARY_MAX_FOLDER_DEPTH}`)
  }
  const baseDir = await resolveManagedDirectory({
    root: input.root,
    scope: input.scope,
    modality: input.modality,
    user: input.user,
    subfolder: parentSubfolder || undefined,
  })
  const folderPath = path.join(baseDir, input.name)
  let exists = false
  try {
    await lstat(folderPath)
    exists = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (exists) throw new Error("A folder with that name already exists")
  return ensureLibraryChild(baseDir, folderPath)
}
