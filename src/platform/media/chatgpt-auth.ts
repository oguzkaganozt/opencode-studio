import { readFile } from "node:fs/promises"
import path from "node:path"
import envPaths from "env-paths"

export type ChatGPTAuth = {
  access: string
  accountId?: string
}

function parseAuth(raw: string) {
  const data = JSON.parse(raw) as Record<string, unknown>
  const entry = data.openai
  if (!entry || typeof entry !== "object") return
  const value = entry as Record<string, unknown>
  if (value.type !== "oauth" || typeof value.access !== "string" || value.access.length === 0) return
  return {
    access: value.access,
    accountId: typeof value.accountId === "string" ? value.accountId : undefined,
  } satisfies ChatGPTAuth
}

export async function loadChatGPTAuth() {
  const injected = process.env.OPENCODE_AUTH_CONTENT
  if (injected) {
    try {
      return parseAuth(injected)
    } catch (error) {
      throw new Error("OPENCODE_AUTH_CONTENT contains invalid JSON", { cause: error })
    }
  }

  const authPath = path.join(envPaths("opencode", { suffix: "" }).data, "auth.json")
  try {
    return parseAuth(await readFile(authPath, "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw new Error(`Could not read OpenCode authentication from ${authPath}`, { cause: error })
  }
}
