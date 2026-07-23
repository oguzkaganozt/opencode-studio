/**
 * File contents for a minimal tscircuit project created by pcb_project_create.
 * Kept in sync with the authoring/wall-sconce-rev-a example project.
 */

export const TSCIRCUIT_VERSION = "0.0.2083"
export const TYPESCRIPT_VERSION = "5.9.3"

function packageJson(projectName: string): string {
  const manifest = {
    name: projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      "build:source": "tsci build src/circuit.tsx",
      check: "tsci check netlist src/circuit.tsx",
      "export:schematic": "tsci export dist/src/circuit/circuit.json --format schematic-svg --output ../../schematic.svg",
      "export:pcb": "tsci export dist/src/circuit/circuit.json --format pcb-svg --output ../../pcb.svg",
      "export:gerbers": "tsci export dist/src/circuit/circuit.json --format gerbers --output ../../circuit-gerbers.zip",
      "export:kicad": "tsci export dist/src/circuit/circuit.json --format kicad_zip --output ../../circuit-kicad.zip",
    },
    dependencies: {
      tscircuit: TSCIRCUIT_VERSION,
    },
    devDependencies: {
      typescript: TYPESCRIPT_VERSION,
    },
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

const tsconfigJson = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "noEmit": true,
    "types": ["tscircuit"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.tsx"]
}
`

const circuitTsx = `import React from "react"
import "tscircuit"

export default () => (
  <board width="20mm" height="15mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} schX={-2} schY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={5} pcbY={0} schX={2} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
  </board>
)
`

export function basicProjectTemplate(projectName: string): Record<string, string> {
  return {
    "package.json": packageJson(projectName),
    "tsconfig.json": tsconfigJson,
    "src/circuit.tsx": circuitTsx,
  }
}
