import { existsSync, readdirSync, statSync } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import envPaths from "env-paths"
import type { FwChipSpec, FwEngine } from "./chips"

export const BUNDLED_IDF_VERSION = "v5.5.4"
export const BUNDLED_QEMU_VERSION = "esp-develop-9.2.2-20250817"
export const BUNDLED_ESP_EMU_VERSION = "0.39.0"
export const IDF_INSTALL_MARKER = ".osc-ready"

export type FwBinarySource = "path" | "env" | "espressif" | "cache"

export type ResolvedFwBinary = {
  id: "idf" | "qemu" | "esp-emu"
  path: string
  source: FwBinarySource
  idfRoot?: string
  toolsPath?: string
}

function fileOk(candidate: string | null | undefined): candidate is string {
  return Boolean(candidate && existsSync(candidate))
}

export function fwCacheDir() {
  return path.join(envPaths("opencode-studio", { suffix: "" }).cache, "fw")
}

function espressifHome() {
  return process.env.IDF_TOOLS_PATH || path.join(homedir(), ".espressif")
}

export function idfRootFromScript(script: string) {
  return path.dirname(path.dirname(script))
}

export function resolveIdf(): ResolvedFwBinary | null {
  const onPath = Bun.which("idf.py")
  if (onPath) {
    return { id: "idf", path: onPath, source: "path", idfRoot: process.env.IDF_PATH || idfRootFromScript(onPath) }
  }
  if (process.env.IDF_PATH) {
    const script = path.join(process.env.IDF_PATH, "tools", "idf.py")
    if (fileOk(script)) return { id: "idf", path: script, source: "env", idfRoot: process.env.IDF_PATH }
  }
  const known = discoverEspressifIdf()
  if (known) return known
  const cachedRoot = path.join(fwCacheDir(), "esp-idf")
  if (isIdfInstallComplete(cachedRoot)) {
    return {
      id: "idf",
      path: path.join(cachedRoot, "tools", "idf.py"),
      source: "cache",
      idfRoot: cachedRoot,
      toolsPath: path.join(fwCacheDir(), "esp-idf-tools"),
    }
  }
  return null
}

export function discoverEspressifIdf(): ResolvedFwBinary | null {
  const root = espressifHome()
  if (!existsSync(root)) return null
  const preferred = ["v5.5.4", "v5.5", "v5.4", "v6.0"]
  for (const name of preferred) {
    const script = path.join(root, name, "esp-idf", "tools", "idf.py")
    if (fileOk(script)) return { id: "idf", path: script, source: "espressif", idfRoot: idfRootFromScript(script) }
  }
  try {
    const entries = readdirSyncSafe(root).sort().reverse()
    for (const name of entries) {
      const script = path.join(root, name, "esp-idf", "tools", "idf.py")
      if (fileOk(script)) return { id: "idf", path: script, source: "espressif", idfRoot: idfRootFromScript(script) }
    }
  } catch {
    return null
  }
  return null
}

function readdirSyncSafe(dir: string) {
  return existsSync(dir) ? readdirSync(dir) : []
}

export function resolveQemu(spec: FwChipSpec): ResolvedFwBinary | null {
  if (!spec.qemuSystem) return null
  const onPath = Bun.which(spec.qemuSystem)
  if (onPath) return { id: "qemu", path: onPath, source: "path" }
  const cached = path.join(fwCacheDir(), "bin", spec.qemuSystem)
  if (fileOk(cached)) return { id: "qemu", path: cached, source: "cache" }
  const found = findQemuInTools(espressifHome(), spec.qemuSystem)
  if (found) return { id: "qemu", path: found, source: "espressif" }
  return null
}

export function resolveEspEmu(): ResolvedFwBinary | null {
  const onPath = Bun.which("esp-emu")
  if (onPath) return { id: "esp-emu", path: onPath, source: "path" }
  const cached = path.join(fwCacheDir(), "bin", "esp-emu")
  if (fileOk(cached)) return { id: "esp-emu", path: cached, source: "cache" }
  return null
}

export function resolveSimEngine(spec: FwChipSpec): ResolvedFwBinary | null {
  return spec.engine === "qemu" ? resolveQemu(spec) : resolveEspEmu()
}

export async function ensureIdf(): Promise<ResolvedFwBinary> {
  const existing = resolveIdf()
  if (existing) return existing
  const dest = path.join(fwCacheDir(), "esp-idf")
  const toolsPath = path.join(fwCacheDir(), "esp-idf-tools")
  await mkdir(fwCacheDir(), { recursive: true, mode: 0o755 })
  if (!fileOk(path.join(dest, "tools", "idf.py"))) {
    const git = Bun.which("git")
    if (!git) throw new Error("git is required to install ESP-IDF into the Firmware Studio cache")
    await rm(dest, { recursive: true, force: true })
    const clone = Bun.spawn(
      [
        git,
        "clone",
        "--depth",
        "1",
        "--branch",
        BUNDLED_IDF_VERSION,
        "--recurse-submodules",
        "--shallow-submodules",
        "https://github.com/espressif/esp-idf.git",
        dest,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    if ((await clone.exited) !== 0) throw new Error("Failed to clone ESP-IDF into Firmware Studio cache")
  }
  const install = Bun.spawn(["bash", path.join(dest, "install.sh"), "esp32,esp32s3,esp32c3,esp32c6,esp32h2,esp32p4"], {
    cwd: dest,
    env: { ...process.env, IDF_PATH: dest, IDF_TOOLS_PATH: toolsPath },
    stdout: "pipe",
    stderr: "pipe",
  })
  if ((await install.exited) !== 0) throw new Error("ESP-IDF install.sh failed")
  const script = path.join(dest, "tools", "idf.py")
  if (!fileOk(script)) throw new Error(`ESP-IDF install finished but ${script} is missing`)
  await Bun.write(path.join(dest, IDF_INSTALL_MARKER), `${BUNDLED_IDF_VERSION}\n`)
  return { id: "idf", path: script, source: "cache", idfRoot: dest, toolsPath }
}

export function isIdfInstallComplete(idfRoot: string) {
  return fileOk(path.join(idfRoot, "tools", "idf.py")) && fileOk(path.join(idfRoot, IDF_INSTALL_MARKER))
}

export async function ensureQemu(spec: FwChipSpec): Promise<ResolvedFwBinary> {
  const existing = resolveQemu(spec)
  if (existing) return existing
  if (!spec.qemuSystem) throw new Error(`Chip ${spec.chip} does not use QEMU`)
  const asset = qemuReleaseAsset(spec.qemuSystem)
  const url = `https://github.com/espressif/qemu/releases/download/${BUNDLED_QEMU_VERSION}/${asset}`
  const dest = path.join(fwCacheDir(), "bin", spec.qemuSystem)
  await installArchiveBinary({ url, asset, dest, binaryName: spec.qemuSystem })
  return { id: "qemu", path: dest, source: "cache" }
}

export async function ensureEspEmu(): Promise<ResolvedFwBinary> {
  const existing = resolveEspEmu()
  if (existing) return existing
  const triple = espEmuTriple()
  const asset = `esp-emu-${BUNDLED_ESP_EMU_VERSION}-${triple}.tar.gz`
  const url = `https://github.com/espressif/esp-emulator/releases/download/v${BUNDLED_ESP_EMU_VERSION}/${asset}`
  const dest = path.join(fwCacheDir(), "bin", "esp-emu")
  await installArchiveBinary({ url, asset, dest, binaryName: "esp-emu" })
  return { id: "esp-emu", path: dest, source: "cache" }
}

export async function ensureSimEngine(spec: FwChipSpec): Promise<ResolvedFwBinary> {
  return spec.engine === "qemu" ? ensureQemu(spec) : ensureEspEmu()
}

export function requireIdf(): ResolvedFwBinary {
  const idf = resolveIdf()
  if (!idf) throw new Error("ESP-IDF is not installed yet. Run fw_build once to download it into the Studio cache.")
  return idf
}

export function requireSimEngine(spec: FwChipSpec): ResolvedFwBinary {
  const engine = resolveSimEngine(spec)
  if (engine) return engine
  throw new Error(`${spec.engine} is not installed yet. Run fw_sim_run once to download it into the Studio cache.`)
}

export function describeEngine(engine: FwEngine) {
  return engine === "qemu" ? "Espressif QEMU" : "esp-emu"
}

export function idfEnv(idf: ResolvedFwBinary): Record<string, string> {
  const env: Record<string, string> = {}
  if (idf.idfRoot) env.IDF_PATH = idf.idfRoot
  if (idf.toolsPath) env.IDF_TOOLS_PATH = idf.toolsPath
  return env
}

export function bashQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function idfCommand(idf: ResolvedFwBinary, args: string[], extraPath: string[] = []) {
  if (idf.idfRoot && fileOk(path.join(idf.idfRoot, "export.sh"))) {
    const pathPrefix = extraPath.length ? `export PATH=${extraPath.map(bashQuote).join(":")}:$PATH; ` : ""
    const quoted = args.map(bashQuote).join(" ")
    return ["bash", "-lc", `${pathPrefix}source ${bashQuote(path.join(idf.idfRoot, "export.sh"))} >/dev/null && idf.py ${quoted}`]
  }
  if (idf.path.endsWith(".py")) {
    const python = Bun.which("python3") ?? Bun.which("python") ?? "python3"
    return [python, idf.path, ...args]
  }
  return [idf.path, ...args]
}

function qemuReleaseAsset(binary: string) {
  const tag = BUNDLED_QEMU_VERSION.replace("esp-develop-", "esp_develop_").replace(/-/g, (match, offset) => (offset > 12 ? "_" : match))
  const host = qemuHostTriple()
  const system = binary === "qemu-system-xtensa" ? "qemu-xtensa-softmmu" : "qemu-riscv32-softmmu"
  return `${system}-${tag}-${host}.tar.xz`
}

function qemuHostTriple() {
  const { platform, arch } = process
  if (platform === "linux" && arch === "x64") return "x86_64-linux-gnu"
  if (platform === "linux" && arch === "arm64") return "aarch64-linux-gnu"
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin"
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin"
  if (platform === "win32" && arch === "x64") return "x86_64-w64-mingw32"
  throw new Error(`No Espressif QEMU binary for ${platform}/${arch}`)
}

function espEmuTriple() {
  const { platform, arch } = process
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu"
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu"
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin"
  throw new Error(`No esp-emu binary for ${platform}/${arch}`)
}

async function downloadFile(url: string, dest: string) {
  const curl = Bun.which("curl")
  if (curl) {
    const proc = Bun.spawn([curl, "-fsSL", "--retry", "3", "--retry-delay", "2", "-o", dest, url], {
      stdout: "pipe",
      stderr: "pipe",
    })
    if ((await proc.exited) === 0 && fileOk(dest)) return
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  await Bun.write(dest, response)
}

async function installArchiveBinary(input: { url: string; asset: string; dest: string; binaryName: string }) {
  await mkdir(path.dirname(input.dest), { recursive: true, mode: 0o755 })
  const staging = await mkdtemp(path.join(tmpdir(), "osc-fw-"))
  try {
    const archivePath = path.join(staging, input.asset)
    await downloadFile(input.url, archivePath)
    if (input.asset.endsWith(".zip")) {
      const unzip = Bun.spawn(["unzip", "-o", archivePath, "-d", staging], { stdout: "pipe", stderr: "pipe" })
      if ((await unzip.exited) !== 0) throw new Error(`Failed to unzip ${input.binaryName}`)
    } else if (input.asset.endsWith(".tar.xz")) {
      const tar = Bun.spawn(["tar", "-xJf", archivePath, "-C", staging], { stdout: "pipe", stderr: "pipe" })
      if ((await tar.exited) !== 0) throw new Error(`Failed to extract ${input.binaryName}`)
    } else {
      const tar = Bun.spawn(["tar", "-xzf", archivePath, "-C", staging], { stdout: "pipe", stderr: "pipe" })
      if ((await tar.exited) !== 0) throw new Error(`Failed to extract ${input.binaryName}`)
    }
    const found = await findFileNamed(staging, input.binaryName)
    if (!found) throw new Error(`${input.binaryName} missing from ${input.asset}`)
    const tmpDest = `${input.dest}.${process.pid}.tmp`
    await copyFile(found, tmpDest)
    await chmod(tmpDest, 0o755)
    await rename(tmpDest, input.dest)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

function findQemuInTools(home: string, binary: string): string | null {
  const pkg = binary === "qemu-system-xtensa" ? "qemu-xtensa" : "qemu-riscv32"
  const root = path.join(home, "tools", pkg)
  if (!existsSync(root)) return null
  return findFileNamedSync(root, binary)
}

function findFileNamedSync(root: string, name: string): string | null {
  const entries = readdirSyncSafe(root)
  for (const entry of entries) {
    const full = path.join(root, entry)
    try {
      const stat = statSync(full)
      if (stat.isFile() && entry === name) return full
      if (stat.isDirectory()) {
        const nested = findFileNamedSync(full, name)
        if (nested) return nested
      }
    } catch {}
  }
  return null
}

async function findFileNamed(root: string, name: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const nested = await findFileNamed(full, name)
      if (nested) return nested
    }
  }
  return null
}
