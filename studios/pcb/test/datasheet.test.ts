import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  attachDatasheetNotes,
  type DatasheetFetch,
  extractLcscPdfUrl,
  renderDatasheetBrief,
  renderDatasheetMarkdown,
  resolveLcscPdfUrl,
} from "../datasheet"

const temps: string[] = []

afterEach(async () => {
  delete process.env.OPENCODE_AUTH_CONTENT
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

const notes = {
  mpn: "TP4056",
  pins: [{ number: "1", name: "TEMP", function: "Battery temperature input" }],
  unused_defaults: ["If unused, connect TEMP directly to GND."],
  typical_notes: "RPROG sets charge current.",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("datasheet URL resolution", () => {
  test("extracts the hashed LCSC PDF from a viewer page", () => {
    expect(extractLcscPdfUrl('<a href="https://datasheet.lcsc.com/datasheet/pdf/55a12534298c2fb7c6e8f83d04194082.pdf">pdf</a>')).toBe(
      "https://datasheet.lcsc.com/datasheet/pdf/55a12534298c2fb7c6e8f83d04194082.pdf",
    )
  })

  test("follows JLCPCB dataManualUrl through an HTML viewer", async () => {
    const fetcher: DatasheetFetch = async (input) => {
      const url = String(input)
      if (url.includes("getComponentDetail")) {
        return jsonResponse({ code: 200, data: { dataManualUrl: "https://www.lcsc.com/datasheet/C725790.pdf" } })
      }
      return new Response("<html>https://datasheet.lcsc.com/datasheet/pdf/55a12534298c2fb7c6e8f83d04194082.pdf</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    }
    await expect(resolveLcscPdfUrl("C725790", fetcher)).resolves.toBe(
      "https://datasheet.lcsc.com/datasheet/pdf/55a12534298c2fb7c6e8f83d04194082.pdf",
    )
  })
})

describe("datasheet attach", () => {
  test("uses ChatGPT when subscription auth is present", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "tok", accountId: "acc" },
    })
    const dir = await mkdtemp(path.join(os.tmpdir(), "pcb-ds-"))
    temps.push(dir)
    await writeFile(path.join(dir, "TP4056.tsx"), "export const TP4056 = () => null\n")
    const fetcher: DatasheetFetch = async (input, init) => {
      const url = String(input)
      if (url.includes("getComponentDetail")) {
        return jsonResponse({
          code: 200,
          data: { dataManualUrl: "https://datasheet.lcsc.com/datasheet/pdf/55a12534298c2fb7c6e8f83d04194082.pdf" },
        })
      }
      if (url.includes("chatgpt.com")) {
        expect(init?.headers && String((init.headers as Record<string, string>).Authorization)).toContain("tok")
        const sse = `data: ${JSON.stringify({ type: "response.completed", response: { output_text: JSON.stringify(notes) } })}\n\n`
        return new Response(sse, { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const result = await attachDatasheetNotes({
      projectDir: dir,
      lcscPartNumber: "C725790",
      relativeTsx: "TP4056.tsx",
      fetcher,
    })
    expect(result).toMatchObject({ ok: true, source: "chatgpt", model: "gpt-5.6-luna", notesPath: "TP4056.notes.md" })
    expect(result.notesMd).toContain("connect TEMP directly to GND")
    expect(await readFile(path.join(dir, "TP4056.notes.md"), "utf8")).toContain("connect TEMP directly to GND")
  })

  test("falls back to OpenRouter when ChatGPT fails", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "tok" },
      openrouter: { type: "api", key: "or-key" },
    })
    const dir = await mkdtemp(path.join(os.tmpdir(), "pcb-ds-"))
    temps.push(dir)
    await writeFile(path.join(dir, "TP4056.tsx"), "export const TP4056 = () => null\n")
    const fetcher: DatasheetFetch = async (input) => {
      const url = String(input)
      if (url.includes("getComponentDetail")) {
        return jsonResponse({
          code: 200,
          data: { dataManualUrl: "https://datasheet.lcsc.com/datasheet/pdf/55a12534298c2fb7c6e8f83d04194082.pdf" },
        })
      }
      if (url.includes("chatgpt.com")) return new Response("nope", { status: 401 })
      if (url.includes("openrouter.ai")) {
        return jsonResponse({ choices: [{ message: { content: JSON.stringify(notes) } }] })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const result = await attachDatasheetNotes({
      projectDir: dir,
      lcscPartNumber: "C725790",
      relativeTsx: "TP4056.tsx",
      fetcher,
    })
    expect(result).toMatchObject({ ok: true, source: "openrouter" })
  })

  test("does not fail the caller when extract is unavailable", async () => {
    process.env.OPENCODE_AUTH_CONTENT = "{}"
    const dir = await mkdtemp(path.join(os.tmpdir(), "pcb-ds-"))
    temps.push(dir)
    await writeFile(path.join(dir, "TP4056.tsx"), "export const TP4056 = () => null\n")
    const result = await attachDatasheetNotes({
      projectDir: dir,
      lcscPartNumber: "C725790",
      relativeTsx: "TP4056.tsx",
      fetcher: async () => jsonResponse({ code: 200, data: {} }),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no datasheet URL/)
  })
})

describe("datasheet markdown", () => {
  test("renders pin and unused sections", () => {
    expect(renderDatasheetMarkdown(notes, { source: "openrouter", model: "gpt-5.6-luna", pdfUrl: "https://example.com/x.pdf" })).toContain(
      "1 TEMP — Battery temperature input",
    )
  })

  test("renders a short brief for the tool response", () => {
    const brief = renderDatasheetBrief({
      ...notes,
      unused_defaults: [
        "TEMP (pin 1): If temperature monitoring is unused, connect TEMP directly to GND. Do not leave it floating.",
        "PROG (pin 2): Connect a resistor from PROG to GND.",
      ],
    })
    expect(brief.split("\n")[0]).toBe("TP4056")
    expect(brief).toContain("connect TEMP directly to GND")
    expect(brief.split("\n").length).toBeLessThanOrEqual(8)
  })
})
