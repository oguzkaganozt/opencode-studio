# OpenCode PCB Studio

An [OpenCode](https://opencode.ai) plugin plus a companion web viewer for
[tscircuit](https://tscircuit.com) PCB projects. The agent designs circuits in
TSX, builds them with the `tsci` CLI, and reviews generated schematics, PCB
layouts, and Circuit JSON in a browser UI.

This is a generic tool: it works with any workspace of tscircuit projects and
carries no product-specific design rules.

## Features

**OpenCode plugin tools**

| Tool | Purpose |
|---|---|
| `pcb_workspace_list` | Discover tscircuit projects (any directory with `src/circuit.tsx`) and their build status |
| `pcb_project_create` | Scaffold a new minimal tscircuit project (package.json, tsconfig, starter `src/circuit.tsx`) and install its dependencies |
| `pcb_circuit_build` | Run `tsci build`, producing and validating `dist/src/circuit/circuit.json` |
| `pcb_circuit_export` | Export schematic/PCB debug SVGs; block Gerbers for errors, placeholders, unverified parts, footprint mismatches, or unconnected pins |
| `pcb_circuit_read` | Read the structured Circuit JSON (components, nets, pads, traces) |
| `pcb_schematic_svg` / `pcb_pcb_svg` | Return the schematic or PCB SVG for visual inspection |
| `pcb_catalog_list` / `pcb_catalog_get` | Browse the workspace part catalog (`catalog/parts/*.yml`) |
| `pcb_component_search` | Search live JLCPCB, tscircuit registry, and KiCad candidates through the official `tsci` CLI |

Build and export results keep operation `success`, subprocess or artifact
generation status, and `designValid` separate. A generated file does not imply
electrical correctness or manufacturing readiness. Gerber and Pick & Place are
blocked for Circuit errors, `PCB_STUDIO_PLACEHOLDER:` notes, unverified complex
part identities, and pins that are neither connected nor explicitly marked
`noConnect`. Supplier part numbers paired with mismatching footprints also
block manufacturing exports.

**Companion viewer** — read-only web UI using tscircuit's official interactive
schematic, PCB, and 3D viewer components. It also provides a Circuit JSON
explorer, Gerber downloads, and the part catalog. Static SVG exports remain as
a fallback if an interactive viewer cannot render a project.

## Setup

```bash
bun install
bun run build        # runtime (dist/) + viewer UI (dist/ui/)
opencode-pcb-studio install   # register plugin + managed skill (OSC)
```

`install` writes the OpenCode plugin entry (`opencode-pcb-studio/server`) and
copies the packaged `pcb-studio` skill with an `.osc-managed.json` ownership
marker. Use `doctor` to inspect health and `remove` to uninstall.

Manual registration is still possible via `opencode.json` if you prefer not to
use the lifecycle CLI. Package identity lives in `opencode-studio.json`.

The plugin always uses the active OpenCode directory as its workspace. Start
OpenCode from the directory containing the tscircuit projects you want to use.

Restart OpenCode after changing plugin code or rebuilding `dist/`.

## Companion viewer

```bash
bun src/cli.ts serve --root .
# or after build:
opencode-pcb-studio serve --root /path/to/workspace --port 4174
```

`--root` is required and must already exist. `--workspace` remains as a
deprecated alias.

Open http://127.0.0.1:4174. The Companion is read-only over the Data Root: it
serves inspection APIs and the Viewer, with Host allowlisting, CSP, and
`nosniff`. Rebuilds stay with agent tools (`pcb_circuit_build` /
`pcb_circuit_export`). The Companion may observe source/artifact changes over
SSE and refresh the UI, but it does not run `tsci` itself.

For tscircuit's own local hot-reload preview, run `npx tsci dev
src/circuit.tsx` inside a project. `tsci dev` is a preview/debug server, not a
browser source-code editor; edit the TSX in your normal editor.

## Workspace layout

- Any directory containing `src/circuit.tsx` is discovered as a project
  (see `authoring/wall-sconce-rev-a` for an example).
- `tsci build src/circuit.tsx` produces `dist/src/circuit/circuit.json`;
  exports land in `dist/schematic.svg`, `dist/pcb.svg`, and
  `dist/circuit-gerbers.zip`. All generated output is untracked.
- `catalog/parts/<mpn>.yml` files form the part catalog exposed through the
  plugin tools and the viewer. The catalog is optional and workspace-local.
  Files are plain YAML with at least an `mpn` field; catalog tools report
  missing, empty, malformed, skipped, and no-match states separately.
- `pcb_component_search` is a read-only remote ecosystem search. `all` merges
  separate JLCPCB, tscircuit registry, and KiCad searches. JLCPCB package
  descriptions are metadata, not directly usable tscircuit footprints;
  registry usage instructions and KiCad footprint values identify implementation
  candidates. Results do not imply workspace catalog approval. Exact matches
  are ranked first; zero-result descriptive queries retry once with a focused
  part token.
- BOM JSON and CSV include Circuit JSON supplier part numbers such as JLCPCB
  codes while keeping manufacturer MPN coverage separate.

## Development

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # biome check
bun run build        # runtime + UI
bun run check        # all of the above + tests
bun run dev:ui       # vite dev server for the viewer
```
