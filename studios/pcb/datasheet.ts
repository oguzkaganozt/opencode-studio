import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import envPaths from "env-paths"
import { isInside } from "../../src/core/paths"
import { loadChatGPTAuth } from "../../src/platform/image/auth"

export const DATASHEET_MODEL = "gpt-5.6-luna"
export const OPENROUTER_DATASHEET_MODEL = "openai/gpt-5.6-luna"
export const JLCPCB_DETAIL_URL = "https://cart.jlcpcb.com/shoppingCart/smtGood/getComponentDetail"
const LCSC_PDF_RE = /https:\/\/datasheet\.lcsc\.com\/datasheet\/pdf\/[a-f0-9]+\.pdf/i
const CODEX_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

export type DatasheetNotes = {
  mpn: string
  pins: Array<{ number: string; name: string; function: string }>
  unused_defaults: string[]
  typical_notes: string
}

export type DatasheetAttachResult = {
  ok: boolean
  source?: "chatgpt" | "openrouter"
  model?: string
  pdfUrl?: string
  notesPath?: string
  notes?: DatasheetNotes
  reason?: string
}

export type DatasheetFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

const NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mpn", "pins", "unused_defaults", "typical_notes"],
  properties: {
    mpn: { type: "string" },
    pins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "name", "function"],
        properties: {
          number: { type: "string" },
          name: { type: "string" },
          function: { type: "string" },
        },
      },
    },
    unused_defaults: { type: "array", items: { type: "string" } },
    typical_notes: { type: "string" },
  },
} as const

const EXTRACT_PROMPT =
  "Extract wiring notes from this datasheet. Do not invent. Include pin names and unused-pin defaults. If a pin such as TEMP is unused and must be grounded, say so explicitly."

function authPath() {
  return path.join(envPaths("opencode", { suffix: "" }).data, "auth.json")
}

export async function loadOpenRouterKey(): Promise<string | undefined> {
  const injected = process.env.OPENCODE_AUTH_CONTENT
  try {
    const raw = injected ?? (await readFile(authPath(), "utf8"))
    const data = JSON.parse(raw) as Record<string, unknown>
    const entry = data.openrouter
    if (!entry || typeof entry !== "object") return
    const value = entry as Record<string, unknown>
    if (value.type === "api" && typeof value.key === "string" && value.key.length > 0) return value.key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}

export function extractLcscPdfUrl(html: string): string | undefined {
  return html.match(LCSC_PDF_RE)?.[0]
}

async function readJson(fetcher: DatasheetFetch, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { signal, headers: { Accept: "application/json", "User-Agent": "opencode-studio" } })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  return response.json()
}

async function readText(
  fetcher: DatasheetFetch,
  url: string,
  signal?: AbortSignal,
): Promise<{ url: string; text: string; bytes: Uint8Array }> {
  const response = await fetcher(url, { signal, headers: { Accept: "*/*", "User-Agent": "opencode-studio" } })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { url: response.url || url, text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), bytes }
}

export async function resolveLcscPdfUrl(lcscPartNumber: string, fetcher: DatasheetFetch = fetch, signal?: AbortSignal): Promise<string> {
  const detail = (await readJson(fetcher, `${JLCPCB_DETAIL_URL}?componentCode=${lcscPartNumber}`, signal)) as {
    code?: number
    data?: { dataManualUrl?: string }
  }
  if (detail.code !== 200 || !detail.data?.dataManualUrl) throw new Error(`JLCPCB detail has no datasheet URL for ${lcscPartNumber}`)
  const manual = detail.data.dataManualUrl
  if (LCSC_PDF_RE.test(manual)) return manual
  const page = await readText(fetcher, manual, signal)
  if (page.bytes[0] === 0x25 && page.bytes[1] === 0x50 && page.bytes[2] === 0x44 && page.bytes[3] === 0x46) return page.url
  const extracted = extractLcscPdfUrl(page.text)
  if (!extracted) throw new Error(`Could not resolve a PDF URL for ${lcscPartNumber}`)
  return extracted
}

function parseNotes(value: unknown): DatasheetNotes {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Datasheet notes must be an object")
  const record = value as Record<string, unknown>
  if (
    typeof record.mpn !== "string" ||
    typeof record.typical_notes !== "string" ||
    !Array.isArray(record.pins) ||
    !Array.isArray(record.unused_defaults)
  ) {
    throw new Error("Datasheet notes are missing required fields")
  }
  return {
    mpn: record.mpn,
    typical_notes: record.typical_notes,
    unused_defaults: record.unused_defaults.filter((item): item is string => typeof item === "string"),
    pins: record.pins.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return []
      const pin = item as Record<string, unknown>
      if (typeof pin.number !== "string" || typeof pin.name !== "string" || typeof pin.function !== "string") return []
      return [{ number: pin.number, name: pin.name, function: pin.function }]
    }),
  }
}

function collectSseOutput(text: string): string {
  let joined = ""
  let completed: string | undefined
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data: ")) continue
      const raw = line.slice(6)
      if (raw === "[DONE]") continue
      let event: Record<string, unknown>
      try {
        event = JSON.parse(raw) as Record<string, unknown>
      } catch {
        continue
      }
      if (event.type === "error" || (typeof event.type === "string" && event.type.endsWith(".failed"))) {
        const message =
          (event.response as { error?: { message?: string } } | undefined)?.error?.message ??
          (typeof event.error === "string" ? event.error : (event.error as { message?: string } | undefined)?.message) ??
          event.type
        throw new Error(`ChatGPT datasheet extract failed: ${message}`)
      }
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") joined += event.delta
      if (event.type === "response.completed") {
        const response = event.response as { output_text?: string } | undefined
        if (typeof response?.output_text === "string" && response.output_text.length > 0) completed = response.output_text
      }
    }
  }
  const out = completed || joined
  if (!out) throw new Error("ChatGPT datasheet extract returned no text")
  return out
}

async function extractViaChatGPT(pdfUrl: string, fetcher: DatasheetFetch, signal?: AbortSignal): Promise<DatasheetNotes> {
  const auth = await loadChatGPTAuth()
  if (!auth) throw new Error("chatgpt_unavailable")
  const response = await fetcher(CODEX_RESPONSES_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.access}`,
      ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
      originator: "opencode",
      Accept: "text/event-stream",
      "OpenAI-Beta": "responses=experimental",
    },
    body: JSON.stringify({
      model: DATASHEET_MODEL,
      store: false,
      stream: true,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: EXTRACT_PROMPT },
            { type: "input_file", file_url: pdfUrl },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "datasheet_notes", strict: true, schema: NOTES_SCHEMA } },
    }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`ChatGPT HTTP ${response.status}: ${body.slice(0, 400)}`)
  return parseNotes(JSON.parse(collectSseOutput(body)))
}

async function extractViaOpenRouter(pdfUrl: string, fetcher: DatasheetFetch, signal?: AbortSignal): Promise<DatasheetNotes> {
  const key = await loadOpenRouterKey()
  if (!key) throw new Error("openrouter_unavailable")
  const response = await fetcher(OPENROUTER_CHAT_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/oguzkaganozt/opencode-studio",
      "X-Title": "opencode-studio",
    },
    body: JSON.stringify({
      model: OPENROUTER_DATASHEET_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "file", file: { filename: "datasheet.pdf", file_data: pdfUrl } },
          ],
        },
      ],
      plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
      response_format: { type: "json_schema", json_schema: { name: "datasheet_notes", strict: true, schema: NOTES_SCHEMA } },
    }),
  })
  const body = (await response.json()) as {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string } }>
  }
  if (!response.ok || body.error) throw new Error(`OpenRouter HTTP ${response.status}: ${body.error?.message ?? "request failed"}`)
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error("OpenRouter datasheet extract returned no content")
  return parseNotes(JSON.parse(content))
}

export function renderDatasheetMarkdown(notes: DatasheetNotes, meta: { source: string; model: string; pdfUrl: string }): string {
  const pins = notes.pins.map((pin) => `- ${pin.number} ${pin.name} — ${pin.function}`).join("\n")
  const unused = notes.unused_defaults.map((item) => `- ${item}`).join("\n")
  return `# ${notes.mpn}

source: ${meta.source} / ${meta.model}
pdf: ${meta.pdfUrl}

## Pins
${pins || "- (none)"}

## Unused
${unused || "- (none)"}

## Typical
${notes.typical_notes}
`
}

export async function writeDatasheetNotes(projectDir: string, relativeTsx: string, markdown: string): Promise<string> {
  const tsx = path.resolve(projectDir, relativeTsx)
  if (!isInside(projectDir, tsx)) throw new Error("Datasheet notes path escapes project")
  const target = tsx.replace(/\.tsx$/i, ".notes.md")
  await writeFile(target, markdown, "utf8")
  return path.relative(projectDir, target).split(path.sep).join("/")
}

export async function attachDatasheetNotes(input: {
  projectDir: string
  lcscPartNumber: string
  relativeTsx: string
  fetcher?: DatasheetFetch
  signal?: AbortSignal
}): Promise<DatasheetAttachResult> {
  const fetcher = input.fetcher ?? fetch
  try {
    const pdfUrl = await resolveLcscPdfUrl(input.lcscPartNumber, fetcher, input.signal)
    let source: "chatgpt" | "openrouter" = "chatgpt"
    let notes: DatasheetNotes
    try {
      notes = await extractViaChatGPT(pdfUrl, fetcher, input.signal)
    } catch {
      source = "openrouter"
      notes = await extractViaOpenRouter(pdfUrl, fetcher, input.signal)
    }
    const markdown = renderDatasheetMarkdown(notes, { source, model: DATASHEET_MODEL, pdfUrl })
    const notesPath = await writeDatasheetNotes(input.projectDir, input.relativeTsx, markdown)
    return { ok: true, source, model: DATASHEET_MODEL, pdfUrl, notesPath, notes }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
