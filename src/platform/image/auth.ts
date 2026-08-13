import { readFile } from "node:fs/promises"
import path from "node:path"
import envPaths from "env-paths"

export type ChatGPTAuth = {
  access: string
  accountId?: string
}

export type XaiAuth = {
  token: string
}

function authPath() {
  return path.join(envPaths("opencode", { suffix: "" }).data, "auth.json")
}

function parseAuthFile(raw: string): Record<string, unknown> {
  const data = JSON.parse(raw) as Record<string, unknown>
  if (!data || typeof data !== "object") throw new Error("OpenCode auth.json is invalid")
  return data
}

async function loadAuthFile() {
  const injected = process.env.OPENCODE_AUTH_CONTENT
  if (injected) {
    try {
      return parseAuthFile(injected)
    } catch (error) {
      throw new Error("OPENCODE_AUTH_CONTENT contains invalid JSON", { cause: error })
    }
  }
  try {
    return parseAuthFile(await readFile(authPath(), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw new Error(`Could not read OpenCode authentication from ${authPath()}`, { cause: error })
  }
}

export async function loadChatGPTAuth(): Promise<ChatGPTAuth | undefined> {
  const data = await loadAuthFile()
  const entry = data?.openai
  if (!entry || typeof entry !== "object") return
  const value = entry as Record<string, unknown>
  if (value.type !== "oauth" || typeof value.access !== "string" || value.access.length === 0) return
  return {
    access: value.access,
    accountId: typeof value.accountId === "string" ? value.accountId : undefined,
  }
}

export async function loadXaiAuth(): Promise<XaiAuth | undefined> {
  const data = await loadAuthFile()
  const entry = data?.xai
  if (!entry || typeof entry !== "object") return
  const value = entry as Record<string, unknown>
  if (typeof value.access === "string" && value.access.length > 0) return { token: value.access }
  if (value.type === "api" && typeof value.key === "string" && value.key.length > 0) return { token: value.key }
}

export function loadFalKey() {
  const key = process.env.FAL_KEY?.trim()
  return key && key.length > 0 ? key : undefined
}
