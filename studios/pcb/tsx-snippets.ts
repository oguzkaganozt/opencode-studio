export const TSX_SNIPPET_KINDS = [
  "board",
  "resistor",
  "capacitor",
  "led",
  "pinheader",
  "connector",
  "chip",
  "keepout",
  "hole",
  "silkscreentext",
  "trace",
] as const

export type TsxSnippetKind = (typeof TSX_SNIPPET_KINDS)[number]

export type TsxSnippet = {
  kind: TsxSnippetKind
  pins: string[]
  snippet: string
  notes?: string[]
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
  connector: {
    kind: "connector",
    pins: ["pin1", "pin2"],
    snippet: `<connector name="J1" pinCount={2} pitch="2.54mm" footprint="pinrow2_p2.54mm" connections={{ pin1: "net.VCC", pin2: "net.GND" }} />`,
    notes: [
      "For an exact USB-C or other complex connector, prefer pcb_component_search/add.",
      "A generic connector still needs an exact footprint whose every declared package pin maps to a physical pad.",
    ],
  },
  chip: {
    kind: "chip",
    pins: ["VIN", "GND", "VOUT", "NC"],
    snippet: `<chip
  name="U1"
  manufacturerPartNumber="EXACT-MPN"
  supplierPartNumbers={{ jlcpcb: ["C000000"] }}
  footprint="pcb_studio_placeholder"
  pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "VOUT", pin4: "NC" }}
  connections={{ VIN: "net.VIN", GND: "net.GND", VOUT: "net.VOUT" }}
  noConnect={["NC"]}
  pinAttributes={{
    VIN: { requiresPower: true },
    GND: { requiresGround: true },
    VOUT: { providesPower: true },
  }}
/>`,
    notes: [
      "Replace pcb_studio_placeholder only with an exact verified footprint.",
      "noConnect exempts routing only; every declared package pin must still map to a physical footprint pad.",
      "Use connections for nets and pinAttributes for power/ground semantics; do not inspect node_modules for these props.",
    ],
  },
  keepout: {
    kind: "keepout",
    pins: [],
    snippet: `<keepout shape="rect" pcbX={10} pcbY={0} width="8mm" height="18mm" layers={["top", "bottom"]} />`,
    notes: ["Place RF antenna and mechanical exclusion zones explicitly; keepouts are not copper or board cutouts."],
  },
  hole: { kind: "hole", pins: [], snippet: `<hole diameter="2.2mm" pcbX={10} pcbY={8} />` },
  silkscreentext: {
    kind: "silkscreentext",
    pins: [],
    snippet: `<silkscreentext text="LABEL" pcbX={0} pcbY={8} fontSize="1mm" anchorAlignment="center" />`,
  },
  trace: { kind: "trace", pins: [], snippet: `<trace from=".R1 > .pin2" to=".D1 > .anode" />` },
}

export function tsxSnippet(kind: TsxSnippetKind): TsxSnippet {
  return SNIPPETS[kind]
}
