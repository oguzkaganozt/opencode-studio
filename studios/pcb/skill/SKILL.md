---
name: studio-pcb
description: Use for PCB design, tscircuit TSX, Circuit JSON diagnostics, Gerber, BOM, CPL/Pick & Place, or pcb_* tools. Guides incremental authoring and honest validation.
---

# PCB Studio

Use PCB Studio for electronic schematics and PCB layouts. Do not load
`studio-cad`; that skill is for mechanical/FDM CAD with build123d.

Studio UI: `http://127.0.0.1:4173/studio` (not bare `/`, which is native OpenCode).
PCB projects live under Studio → PCB. The viewer can send diagnostics to the Agent
panel; treat that draft as user intent, then fix with tools below.

## Workflow

1. Call `pcb_workspace_list` and `pcb_catalog_list` once before authoring.
   The catalog is optional and workspace-local; do not repeat searches when it
   reports that no catalog is available.
2. Decide exact parts before claiming a production-oriented design. Record the
   MPN, pinout, footprint, and whether each complex device is a module or bare
   IC. When the local catalog has no exact match, call `pcb_component_search`
   with each named complex part's exact MPN before inspecting `node_modules` or
   searching the web. Treat search results as candidates, not catalog approval.
   For an exact JLCPCB match, use the returned `supplierPartNumbers` and verify
   the generated pinout and footprint; `packageDescription` is metadata, not a
   tscircuit footprint string. Prefer exact tscircuit `usageInstructions` or a
   KiCad `footprint`; do not combine an MPN with an unrelated generic footprint.
   Generic pin rows and generic QFN footprints are placeholders unless they
   match the selected part.
   If the exact footprint is unavailable, do not invent one. Reserve a
   conservative area with `<keepout shape="rect" ... />`, outline it with
   `<pcbnoterect ... />`, and label it with
   `<pcbnotetext text="PCB_STUDIO_PLACEHOLDER: U1 - exact footprint required" ... />`.
3. Build incrementally: board and power, MCU, peripherals, then placement and
   routing. Run `pcb_circuit_build` after each meaningful stage.
4. After the first build, make targeted edits instead of rewriting the entire
   `src/circuit.tsx`. Read locally installed tscircuit source and types before
   broad web research.
5. Use compact build diagnostics first. For complete records, call
   `pcb_circuit_read` with the exact error type in `types`; do not fetch full
   Circuit JSON unless necessary. Fix placement errors rather than disabling
   placement DRC.
6. Use schematic and PCB SVG exports to debug incomplete designs. Gerber and
   CPL are blocked while placeholders, unverified complex part identities,
   supplier footprint mismatches, or unconnected non-`noConnect` pins remain.

## Worked micro-flow (first board)

Typical loop for a new project (names are illustrative):

1. `pcb_workspace_list` → note empty or existing project ids under the domain root.
2. Author or scaffold `src/circuit.tsx` (board outline, nets, power, then MCU).
3. `pcb_circuit_build` with the project id → read `success`, `designValid`,
   `fabricationReady`, `assemblyReady`, and `manufacturingBlockers`.
4. If errors: `pcb_circuit_read` filtered by error `types` → targeted TSX edit →
   rebuild. Prefer one stage at a time over a full rewrite.
5. When `designValid` is true but fab/assembly is false, clear blockers (placeholders,
   missing MPN, unconnected pins) before exporting Gerber/CPL.
6. Export only after readiness matches the claim you will make (see table below).
7. Open Studio PCB viewer (`/studio` → PCB) to confirm schematic/PCB previews.
   If the user sent diagnostics via **Send diagnostics to agent**, treat that text
   as the current defect list and re-run build after fixes.

## Readiness field table

Tools return separate axes. Never collapse them into a single “done”.

| Field | Meaning | When false / incomplete |
| --- | --- | --- |
| `success` | Process finished and `designValid` is true (build tools) | Treat as blocked; do not claim a good build |
| `designValid` | Circuit JSON has zero design errors | Hard incomplete; fix diagnostics first |
| `errorCount` / `warningCount` | Compact diagnostic totals | Errors block validity; warnings need explicit callout |
| `fabricationReady` | No manufacturing blockers (placeholders, identity, fab pins, etc.) | Do not claim Gerber/fab readiness |
| `assemblyReady` | Fab-ready **and** BOM complete (MPN coverage) | Do not claim pick-and-place / assembly readiness |
| `manufacturingBlockers` | Why fab is blocked | Quote these; do not invent clearance |
| `debugOnly` | Build useful for debug only (invalid design) | Never present as production-ready |
| `bomComplete` (BOM tools) | Every BOM line has an MPN where required | Blocks `assemblyReady` |

Honesty rules:

- Verify power rails, ground references, decoupling, USB requirements, RF
  keepouts, connector orientation, and physical accessibility where relevant.
- Confirm BOM MPN coverage and that footprints match exact selected parts.
- Inspect schematic and PCB previews before reporting visual review complete.
- Report every unresolved error and design assumption.
- Treat `success: false` or `designValid: false` as a hard incomplete state.
  Finish as blocked or partial if errors cannot be resolved.
- Never claim manufacturing readiness from tool success alone. The tools do not
  prove electrical correctness, datasheet compliance, or production fitness.
- Claim fab only if `fabricationReady: true`; claim assembly only if
  `assemblyReady: true`. Partial boards stay labeled partial/blocked.
