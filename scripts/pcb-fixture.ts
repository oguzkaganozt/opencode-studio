/**
 * PCB fixture presence check (does not build the authoring project).
 * Ensures the packed/authoring wall-sconce fixture tree is on disk for local/CI use.
 */
import path from "node:path"

const fixture = path.resolve(import.meta.dir, "../studios/pcb/authoring/wall-sconce-rev-a")
const pkg = Bun.file(path.join(fixture, "package.json"))
if (!(await pkg.exists())) {
  console.error("PCB authoring fixture missing")
  process.exit(1)
}
const circuit = Bun.file(path.join(fixture, "src/circuit.tsx"))
if (!(await circuit.exists())) {
  console.error("PCB authoring fixture incomplete (src/circuit.tsx missing)")
  process.exit(1)
}
console.log("pcb-fixture present:", fixture)
process.exit(0)
