import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { Agent } from "@mastra/core/agent"

const here = path.dirname(fileURLToPath(import.meta.url))

function parseKey(text: string): string | undefined {
  const line = text.split("\n").find((item) => item.includes("OPENROUTER_API_KEY="))
  if (!line) return undefined
  return line.split("=", 2)[1]?.trim().replace(/^export\s+/, "").replace(/^["']|["']$/g, "")
}

async function loadOpenRouterKey(): Promise<string | undefined> {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  for (const file of [path.join(here, "..", ".env"), path.join(process.env.HOME ?? "", ".bashrc")]) {
    try {
      const key = parseKey(await readFile(file, "utf8"))
      if (key) return key
    } catch {
      // next source
    }
  }
  return undefined
}

const MODELS = ["openrouter/google/gemini-2.5-flash-lite", "openrouter/meta-llama/llama-3.2-3b-instruct"] as const

test("same agent generates through two OpenRouter providers", async (t) => {
  const key = await loadOpenRouterKey()
  if (!key) {
    t.skip("OPENROUTER_API_KEY missing")
    return
  }
  process.env.OPENROUTER_API_KEY = key
  const texts: string[] = []
  for (const model of MODELS) {
    const agent = new Agent({
      id: "byok-probe",
      name: "byok-probe",
      instructions: "Reply with the single word pong and nothing else.",
      model,
    })
    const result = await agent.generate("ping")
    assert.ok(result.text && result.text.length > 0, `${model} returned empty text`)
    texts.push(`${model}:${result.text}`)
  }
  assert.equal(texts.length, 2)
})
