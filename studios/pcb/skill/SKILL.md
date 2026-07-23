---
name: pcb-studio
description: Use for PCB design, tscircuit TSX, Circuit JSON diagnostics, Gerber, BOM, CPL/Pick & Place, or pcb_* tools. Guides incremental authoring and honest validation.
---

# PCB Studio

Use PCB Studio for electronic schematics and PCB layouts. Do not load
`cad-studio`; that skill is for mechanical/FDM CAD with build123d.

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

## Readiness Checks

- Verify power rails, ground references, decoupling, USB requirements, RF
  keepouts, connector orientation, and physical accessibility where relevant.
- Confirm BOM MPN coverage and that footprints match exact selected parts.
- Inspect schematic and PCB previews before reporting visual review complete.
- Report every unresolved error and design assumption.
- Treat `success: false` or `designValid: false` as a hard incomplete state.
  Finish as blocked or partial if errors cannot be resolved.
- Never claim manufacturing readiness from tool success alone. The tools do not
  prove electrical correctness, datasheet compliance, or production fitness.
