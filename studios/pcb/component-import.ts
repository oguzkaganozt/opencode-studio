import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { link, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, stat, unlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { engineCommand, resolveTsci } from "../../src/core/engines"
import { canonicalExistingDirectory, isInside, readRegularFileAt } from "../../src/core/paths"

const IMPORT_TIMEOUT_MS = 30_000
const MAX_COMPONENT_BYTES = 2 * 1024 * 1024
const MAX_PROCESS_OUTPUT_CHARS = 16_000
const C_NUMBER_PATTERN = /^C[1-9]\d*$/
const SHA256_PATTERN = /^[a-f\d]{64}$/i

export type ExactLcscImportInput = {
  projectDir: string
  lcscPartNumber: string
  expectedSha256?: string
}

export type ExactLcscImportCommand = {
  argv: string[]
  cwd: string
  timeoutMs: number
}

export type ExactLcscImportCommandResult = {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
  timedOut?: boolean
}

export type ExactLcscSmokeInput = {
  projectDir: string
  filePath: string
  relativePath: string
  lcscPartNumber: string
  exportName: string
  manufacturerPartNumber: string
  sha256: string
}

export type ExactLcscSmokeResult = {
  success: boolean
  stdout?: string
  stderr?: string
  exitCode?: number
  courtyard?: { widthMm: number; heightMm: number }
}

export type ExactLcscImportDependencies = {
  run?: (command: ExactLcscImportCommand) => Promise<ExactLcscImportCommandResult>
  smoke: (input: ExactLcscSmokeInput) => Promise<ExactLcscSmokeResult>
}

export type ExactLcscImportFailureReason =
  | "invalid_input"
  | "engine_unavailable"
  | "command_failed"
  | "invalid_generated_file"
  | "supplier_identity_mismatch"
  | "invalid_component_metadata"
  | "sha256_mismatch"
  | "destination_exists"
  | "smoke_test_failed"
  | "filesystem_error"

export type ExactLcscImportResult =
  | ({ success: true; rolledBack: false; courtyard?: { widthMm: number; heightMm: number } } & ExactLcscSmokeInput)
  | {
      success: false
      reason: ExactLcscImportFailureReason
      message: string
      lcscPartNumber: string
      rolledBack: boolean
      filePath?: string
      stdout?: string
      stderr?: string
      exitCode?: number
    }

class ImportFailure extends Error {
  constructor(
    readonly reason: ExactLcscImportFailureReason,
    message: string,
    readonly details: Partial<Pick<ExactLcscImportCommandResult, "stdout" | "stderr" | "exitCode">> = {},
  ) {
    super(message)
  }
}

function clipped(value: string): string {
  return value.slice(-MAX_PROCESS_OUTPUT_CHARS)
}

async function runPinnedTsci(command: ExactLcscImportCommand): Promise<ExactLcscImportCommandResult> {
  const timeout = AbortSignal.timeout(command.timeoutMs)
  const proc = Bun.spawn(command.argv, {
    cwd: command.cwd,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: timeout,
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return {
    success: exitCode === 0 && !timeout.aborted,
    stdout: clipped(stdout),
    stderr: clipped(stderr),
    exitCode,
    timedOut: timeout.aborted,
  }
}

function validateInput(input: ExactLcscImportInput): void {
  if (!C_NUMBER_PATTERN.test(input.lcscPartNumber)) {
    throw new ImportFailure("invalid_input", "lcscPartNumber must be canonical (uppercase C followed by a non-zero decimal number)")
  }
  if (input.expectedSha256 !== undefined && !SHA256_PATTERN.test(input.expectedSha256)) {
    throw new ImportFailure("invalid_input", "expectedSha256 must be a 64-character hexadecimal SHA-256 digest")
  }
}

async function generatedTsxFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await generatedTsxFiles(root, entryPath)))
    } else if (entry.name.toLowerCase().endsWith(".tsx")) {
      const info = await lstat(entryPath)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new ImportFailure("invalid_generated_file", `Generated TSX is not a regular file: ${path.relative(root, entryPath)}`)
      }
      files.push(entryPath)
    }
  }
  return files
}

function extractExportName(source: string): string {
  const names: string[] = []
  const declaration = /\bexport\s+(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
  for (const match of source.matchAll(declaration)) names.push(match[1]!)
  const lists = /\bexport\s*\{([^}]*)\}/g
  for (const match of source.matchAll(lists)) {
    for (const item of match[1]!.split(",")) {
      const name =
        item
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[1] ??
        item
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+/)[0]
      if (name) names.push(name)
    }
  }
  if (names.length !== 1) throw new ImportFailure("invalid_component_metadata", `Expected exactly one named export, found ${names.length}`)
  return names[0]!
}

function extractManufacturerPartNumber(source: string): string {
  const expression = /\bmanufacturerPartNumber\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*(?:"([^"]+)"|'([^']+)')\s*\})/g
  const values = [...source.matchAll(expression)].map((match) => match.slice(1).find((value) => value !== undefined)!)
  if (values.length !== 1) {
    throw new ImportFailure("invalid_component_metadata", `Expected exactly one literal manufacturerPartNumber, found ${values.length}`)
  }
  return values[0]!
}

function assertSupplierIdentity(source: string, lcscPartNumber: string): void {
  const supplierBlocks = [...source.matchAll(/\bsupplierPartNumbers\s*=\s*\{\{([\s\S]*?)\}\}/g)].map((match) => match[1]!)
  const found = supplierBlocks.some((block) => {
    const jlcpcb = block.match(/(?:\bjlcpcb\b|["']jlcpcb["'])\s*:\s*\[([^\]]*)\]/)
    if (!jlcpcb) return false
    return [...jlcpcb[1]!.matchAll(/["'](C\d+)["']/g)].some((match) => match[1] === lcscPartNumber)
  })
  if (!found)
    throw new ImportFailure("supplier_identity_mismatch", `Generated component does not identify exact JLCPCB part ${lcscPartNumber}`)
}

async function ensureImportsDirectory(projectDir: string): Promise<string> {
  const importsDir = path.join(projectDir, "imports")
  try {
    const info = await lstat(importsDir)
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new ImportFailure("filesystem_error", "Project imports path is not a regular directory")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await mkdir(importsDir, { mode: 0o755 })
  }
  const canonical = await realpath(importsDir)
  if (!isInside(projectDir, canonical))
    throw new ImportFailure("filesystem_error", "Project imports directory resolves outside the project")
  return canonical
}

async function publishExclusive(source: Buffer, target: string): Promise<{ temporary: string; dev: number; ino: number }> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o644)
  try {
    await handle.writeFile(source)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await link(temporary, target)
    const info = await stat(temporary)
    return { temporary, dev: info.dev, ino: info.ino }
  } catch (error) {
    await rm(temporary, { force: true })
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ImportFailure("destination_exists", `Refusing to overwrite existing import: ${target}`)
    }
    throw error
  }
}

async function rollbackPublished(target: string, published: { dev: number; ino: number }): Promise<boolean> {
  try {
    const current = await lstat(target)
    if (!current.isFile() || current.dev !== published.dev || current.ino !== published.ino) return false
    await unlink(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

export async function importExactLcscComponent(
  input: ExactLcscImportInput,
  dependencies: ExactLcscImportDependencies,
): Promise<ExactLcscImportResult> {
  let staging: string | undefined
  let target: string | undefined
  let published: { temporary: string; dev: number; ino: number } | undefined
  try {
    validateInput(input)
    const projectDir = await canonicalExistingDirectory(input.projectDir, "projectDir")
    const engine = resolveTsci()
    if (!engine && !dependencies.run) throw new ImportFailure("engine_unavailable", "Pinned tsci engine is unavailable")

    staging = await mkdtemp(path.join(os.tmpdir(), "pcb-lcsc-import-"))
    const argv = [...(engine ? engineCommand(engine) : ["tsci"]), "import", "--jlcpcb", "--use-exact-footprint", input.lcscPartNumber]
    const command = await (dependencies.run ?? runPinnedTsci)({ argv, cwd: staging, timeoutMs: IMPORT_TIMEOUT_MS })
    if (!command.success) {
      const timeoutMessage = command.timedOut ? ` after ${IMPORT_TIMEOUT_MS}ms` : ""
      throw new ImportFailure("command_failed", `tsci import failed${timeoutMessage}`, command)
    }

    const generated = await generatedTsxFiles(staging)
    if (generated.length !== 1) {
      throw new ImportFailure("invalid_generated_file", `Expected exactly one generated TSX file, found ${generated.length}`)
    }
    const bytes = await readRegularFileAt(staging, generated[0]!)
    if (bytes.byteLength > MAX_COMPONENT_BYTES) {
      throw new ImportFailure("invalid_generated_file", `Generated TSX exceeds ${MAX_COMPONENT_BYTES} bytes`)
    }
    const source = bytes.toString("utf8")
    assertSupplierIdentity(source, input.lcscPartNumber)
    const exportName = extractExportName(source)
    const manufacturerPartNumber = extractManufacturerPartNumber(source)
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    if (input.expectedSha256 && sha256 !== input.expectedSha256.toLowerCase()) {
      throw new ImportFailure("sha256_mismatch", `Generated TSX SHA-256 ${sha256} does not match expected digest`)
    }

    const importsDir = await ensureImportsDirectory(projectDir)
    const filename = path.basename(generated[0]!)
    target = path.join(importsDir, filename)
    published = await publishExclusive(bytes, target)
    const smokeInput: ExactLcscSmokeInput = {
      projectDir,
      filePath: target,
      relativePath: path.relative(projectDir, target).split(path.sep).join("/"),
      lcscPartNumber: input.lcscPartNumber,
      exportName,
      manufacturerPartNumber,
      sha256,
    }
    let smoke: ExactLcscSmokeResult
    try {
      smoke = await dependencies.smoke(smokeInput)
    } catch (error) {
      smoke = { success: false, stderr: error instanceof Error ? error.message : String(error) }
    }
    if (!smoke.success) {
      const rolledBack = await rollbackPublished(target, published)
      await rm(published.temporary, { force: true })
      published = undefined
      return {
        success: false,
        reason: "smoke_test_failed",
        message: "Imported component failed the project smoke test",
        lcscPartNumber: input.lcscPartNumber,
        rolledBack,
        filePath: target,
        stdout: smoke.stdout,
        stderr: smoke.stderr,
        exitCode: smoke.exitCode,
      }
    }
    await rm(published.temporary, { force: true })
    published = undefined
    return { success: true, rolledBack: false, ...smokeInput, courtyard: smoke.courtyard }
  } catch (error) {
    let rolledBack = false
    if (target && published) rolledBack = await rollbackPublished(target, published).catch(() => false)
    const failure =
      error instanceof ImportFailure ? error : new ImportFailure("filesystem_error", error instanceof Error ? error.message : String(error))
    return {
      success: false,
      reason: failure.reason,
      message: failure.message,
      lcscPartNumber: input.lcscPartNumber,
      rolledBack,
      filePath: target,
      ...failure.details,
    }
  } finally {
    if (published) await rm(published.temporary, { force: true }).catch(() => {})
    if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}
