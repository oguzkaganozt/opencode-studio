import board from "./reference/tscircuit/elements/board.md" with { type: "text" }
import capacitor from "./reference/tscircuit/elements/capacitor.md" with { type: "text" }
import chip from "./reference/tscircuit/elements/chip.md" with { type: "text" }
import connector from "./reference/tscircuit/elements/connector.md" with { type: "text" }
import footprint from "./reference/tscircuit/elements/footprint.md" with { type: "text" }
import hole from "./reference/tscircuit/elements/hole.md" with { type: "text" }
import led from "./reference/tscircuit/elements/led.md" with { type: "text" }
import pcbkeepout from "./reference/tscircuit/elements/pcbkeepout.md" with { type: "text" }
import pinheader from "./reference/tscircuit/elements/pinheader.md" with { type: "text" }
import resistor from "./reference/tscircuit/elements/resistor.md" with { type: "text" }
import silkscreentext from "./reference/tscircuit/elements/silkscreentext.md" with { type: "text" }
import trace from "./reference/tscircuit/elements/trace.md" with { type: "text" }
import footprints from "./reference/tscircuit/FOOTPRINTS.md" with { type: "text" }
import syntax from "./reference/tscircuit/SYNTAX.md" with { type: "text" }

const MAX_QUERY_LENGTH = 100
const MAX_MATCHES = 5
const MAX_CONTENT_LENGTH = 12_000

export const TSCIRCUIT_REFERENCE_METADATA = {
  authority: "official" as const,
  usage: "reference-only" as const,
  corpusVersion: "1",
  tscircuitVersion: "0.0.2306",
  repository: "https://github.com/tscircuit/skill",
  commit: "3dbfeec2d2c9d2dafa3358376bae8676fff379c7",
  commitDate: "2026-08-13T16:56:54-06:00",
  license: "MIT",
  networkAccess: false,
}

type ReferenceEntry = {
  id: string
  title: string
  aliases: readonly string[]
  path: string
  content: string
}

const ENTRIES: readonly ReferenceEntry[] = [
  { id: "board", title: "board element", aliases: ["pcb board"], path: "elements/board.md", content: board },
  { id: "capacitor", title: "capacitor element", aliases: ["cap"], path: "elements/capacitor.md", content: capacitor },
  { id: "chip", title: "chip element", aliases: ["ic", "integrated circuit"], path: "elements/chip.md", content: chip },
  {
    id: "connector",
    title: "connector element",
    aliases: ["usb", "usb-c", "usbc", "usb_c", "usb connector"],
    path: "elements/connector.md",
    content: connector,
  },
  { id: "footprint", title: "custom footprint element", aliases: ["custom package"], path: "elements/footprint.md", content: footprint },
  {
    id: "footprints",
    title: "footprinter string reference",
    aliases: ["packages", "standard footprints"],
    path: "FOOTPRINTS.md",
    content: footprints,
  },
  { id: "hole", title: "non-conductive hole element", aliases: ["mounting hole"], path: "elements/hole.md", content: hole },
  {
    id: "keepout",
    title: "PCB keepout element",
    aliases: ["pcbkeepout", "pcb keepout"],
    path: "elements/pcbkeepout.md",
    content: pcbkeepout,
  },
  { id: "led", title: "LED element", aliases: ["light emitting diode"], path: "elements/led.md", content: led },
  { id: "pinheader", title: "pin header element", aliases: ["pin header", "header"], path: "elements/pinheader.md", content: pinheader },
  { id: "resistor", title: "resistor element", aliases: ["res"], path: "elements/resistor.md", content: resistor },
  {
    id: "silkscreentext",
    title: "silkscreen text element",
    aliases: ["silkscreen text", "silk text"],
    path: "elements/silkscreentext.md",
    content: silkscreentext,
  },
  { id: "syntax", title: "tscircuit syntax primer", aliases: ["tsx syntax", "jsx syntax", "primer"], path: "SYNTAX.md", content: syntax },
  { id: "trace", title: "trace element", aliases: ["connection", "wire"], path: "elements/trace.md", content: trace },
]

export type TscircuitReferenceMatch = {
  id: string
  title: string
  path: string
  aliases: string[]
  content: string
}

export type TscircuitReferenceLookup = {
  status: "exact" | "ambiguous" | "not_found" | "invalid"
  query: string
  matchedBy?: "id" | "alias"
  matches: TscircuitReferenceMatch[]
  warnings: string[]
  metadata: typeof TSCIRCUIT_REFERENCE_METADATA
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[<>/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function resultMatch(entry: ReferenceEntry): TscircuitReferenceMatch {
  return {
    id: entry.id,
    title: entry.title,
    path: entry.path,
    aliases: [...entry.aliases],
    content: entry.content.slice(0, MAX_CONTENT_LENGTH),
  }
}

function compatibilityWarnings(query: string, entries: readonly ReferenceEntry[]): string[] {
  const warnings: string[] = []
  if (query === "pcbkeepout" || query === "pcb keepout") {
    warnings.push("Compatibility override: use the current runtime element `<keepout />`; the pinned reference names it `<pcbkeepout />`.")
  }
  if (entries.some((entry) => entry.id === "connector") && /\busb(?:\s*c|c)?\b/.test(query)) {
    warnings.push(
      "USB-C reference syntax is not a readiness guarantee. Verify the exact connector, footprint pad mapping, CC resistors, power role, and routed USB nets before marking the design ready.",
    )
  }
  return warnings
}

/** Looks up the pinned official corpus without filesystem or network access. */
export function lookupTscircuitReference(rawQuery: string): TscircuitReferenceLookup {
  const query = normalize(rawQuery)
  const base = { query, metadata: TSCIRCUIT_REFERENCE_METADATA }
  if (!query || rawQuery.length > MAX_QUERY_LENGTH) return { ...base, status: "invalid", matches: [], warnings: [] }

  const idMatch = ENTRIES.find((entry) => normalize(entry.id) === query)
  const aliasMatch = idMatch ?? ENTRIES.find((entry) => entry.aliases.some((alias) => normalize(alias) === query))
  if (aliasMatch) {
    return {
      ...base,
      status: "exact",
      matchedBy: idMatch ? "id" : "alias",
      matches: [resultMatch(aliasMatch)],
      warnings: compatibilityWarnings(query, [aliasMatch]),
    }
  }

  const terms = query.split(" ")
  const matches = ENTRIES.filter((entry) => {
    const index = normalize([entry.id, entry.title, ...entry.aliases, entry.content].join(" "))
    return terms.every((term) => index.includes(term))
  }).slice(0, MAX_MATCHES)

  return {
    ...base,
    status: matches.length > 0 ? "ambiguous" : "not_found",
    matches: matches.map(resultMatch),
    warnings: compatibilityWarnings(query, matches),
  }
}
