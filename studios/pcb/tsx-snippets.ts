export const TSX_SNIPPET_KINDS = ["board", "resistor", "capacitor", "led", "pinheader", "chip", "trace"] as const

export type TsxSnippetKind = (typeof TSX_SNIPPET_KINDS)[number]

export type TsxSnippet = {
  kind: TsxSnippetKind
  pins: string[]
  snippet: string
}

const SNIPPETS: Record<TsxSnippetKind, TsxSnippet> = {
  board: {
    kind: "board",
    pins: [],
    snippet: `<board width="20mm" height="15mm">\n</board>`,
  },
  resistor: { kind: "resistor", pins: ["pin1", "pin2"], snippet: `<resistor name="R1" resistance="330" footprint="0603" />` },
  capacitor: { kind: "capacitor", pins: ["pin1", "pin2"], snippet: `<capacitor name="C1" capacitance="100nF" footprint="0603" />` },
  led: { kind: "led", pins: ["anode", "cathode", "pin1", "pin2"], snippet: `<led name="D1" color="red" footprint="0603" />` },
  pinheader: {
    kind: "pinheader",
    pins: ["pin1", "pin2"],
    snippet: `<pinheader name="J1" pinCount={2} pitch="2.54mm" gender="male" footprint="pinrow2_p2.54mm" />`,
  },
  chip: {
    kind: "chip",
    pins: [],
    snippet: `<chip name="U1" manufacturerPartNumber="ESP32-S3-WROOM-1" footprint="pcb_studio_placeholder" />`,
  },
  trace: { kind: "trace", pins: [], snippet: `<trace from=".R1 > .pin2" to=".D1 > .anode" />` },
}

export function tsxSnippet(kind: TsxSnippetKind): TsxSnippet {
  return SNIPPETS[kind]
}
