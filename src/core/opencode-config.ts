import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { applyEdits, modify, type ParseError, parse, printParseErrorCode } from "jsonc-parser"

export type OpenCodeConfig = {
  exists: boolean
  text: string
  value: Record<string, unknown>
  filePath: string
}

function parseConfig(text: string, filePath: string) {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as unknown
  if (errors.length > 0) {
    const first = errors[0]!
    throw new Error(`Invalid OpenCode config at ${filePath}: ${printParseErrorCode(first.error)} at offset ${first.offset}`)
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OpenCode config must be an object: ${filePath}`)
  }
  const config = value as Record<string, unknown>
  if (config.plugin !== undefined) validatePluginEntries(config.plugin)
  return config
}

function validatePluginEntries(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error("OpenCode config plugin field must be an array")
  for (const entry of value) {
    if (typeof entry === "string") continue
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      entry[1] !== null &&
      typeof entry[1] === "object" &&
      !Array.isArray(entry[1])
    ) {
      continue
    }
    throw new Error("OpenCode config contains an invalid plugin entry")
  }
}

export async function resolveOpenCodeConfigPath(workspace: string) {
  const jsonc = path.join(workspace, "opencode.jsonc")
  const json = path.join(workspace, "opencode.json")
  const hasJsonc = await Bun.file(jsonc).exists()
  const hasJson = await Bun.file(json).exists()
  if (hasJsonc && hasJson) {
    throw new Error("Both opencode.json and opencode.jsonc exist; keep exactly one")
  }
  if (hasJsonc) return jsonc
  if (hasJson) return json
  return json
}

export async function readOpenCodeConfig(filePath: string): Promise<OpenCodeConfig> {
  try {
    const text = await readFile(filePath, "utf8")
    return { exists: true, text, value: parseConfig(text, filePath), filePath }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const text = `{
  "$schema": "https://opencode.ai/config.json"
}
`
      return { exists: false, text, value: parseConfig(text, filePath), filePath }
    }
    throw error
  }
}

export function pluginEntries(config: OpenCodeConfig) {
  const value = config.value.plugin
  if (value === undefined) return []
  validatePluginEntries(value)
  return value
}

export function configWithPlugins(config: OpenCodeConfig, plugins: unknown[]) {
  validatePluginEntries(plugins)
  const edits = modify(config.text, ["plugin"], plugins, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  })
  const text = applyEdits(config.text, edits)
  parseConfig(text, "generated config")
  return text.endsWith("\n") ? text : `${text}\n`
}

export function mcpEntries(config: OpenCodeConfig): Record<string, unknown> {
  const value = config.value.mcp
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenCode config mcp field must be an object")
  }
  return { ...(value as Record<string, unknown>) }
}

export function configWithMcp(config: OpenCodeConfig, mcp: Record<string, unknown> | undefined) {
  const edits = modify(config.text, ["mcp"], mcp && Object.keys(mcp).length > 0 ? mcp : undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  })
  const text = applyEdits(config.text, edits)
  parseConfig(text, "generated config")
  return text.endsWith("\n") ? text : `${text}\n`
}

async function validateWithOpenCode(candidate: string) {
  const validationRoot = await mkdtemp(path.join(tmpdir(), "osc-config-validation-"))
  try {
    const proc = Bun.spawn(["opencode", "debug", "config"], {
      cwd: validationRoot,
      env: {
        ...process.env,
        HOME: path.join(validationRoot, "home"),
        XDG_CONFIG_HOME: path.join(validationRoot, "xdg"),
        OPENCODE_CONFIG: candidate,
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
        OPENCODE_PURE: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    if (exitCode !== 0) {
      throw new Error(`OpenCode rejected the updated config: ${stderr.trim() || `exit ${exitCode}`}`)
    }
  } catch (error) {
    // Host-only / CI environments may not have the opencode binary. JSONC was
    // already parse-checked; skip live validation rather than blocking configure.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  } finally {
    await rm(validationRoot, { recursive: true, force: true })
  }
}

export async function atomicWriteOpenCodeConfig(filePath: string, text: string, expectedText: string, options?: { validate?: boolean }) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp.json`
  try {
    parseConfig(text, filePath)
    await writeFile(temporary, text, { mode: 0o644 })
    if (options?.validate !== false) {
      await validateWithOpenCode(temporary)
    }

    try {
      const current = await readFile(filePath, "utf8")
      if (current !== expectedText) throw new Error(`OpenCode config changed concurrently: ${filePath}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || expectedText !== "") throw error
    }
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true })
  }
}

function entryName(entry: unknown): string | null {
  if (typeof entry === "string") return entry
  if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0]
  return null
}

export function pluginEntryMatches(entry: unknown, pluginSpecifier: string) {
  const name = entryName(entry)
  if (!name) return false
  return name === pluginSpecifier || name.startsWith(`${pluginSpecifier}@`) || name.startsWith(`${pluginSpecifier}/`)
}

/**
 * Package name from an OpenCode plugin entry (`name`, `name@version`, `@scope/name@version/subpath`).
 * Scoped names keep the leading `@` (must not split on the first `@`).
 */
export function pluginBaseName(entry: unknown): string | null {
  const name = entryName(entry)
  if (!name) return null
  if (name.startsWith("@")) {
    const match = name.match(/^(@[^/]+\/[^@/]+)/)
    return match?.[1] ?? name
  }
  return name.split("@")[0] ?? name
}

/** Former unscoped package name — strip on configure so workspaces migrate cleanly. */
export const LEGACY_PACKAGE_NAMES = ["opencode-studio"] as const
