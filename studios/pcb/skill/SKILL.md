---
name: studio-pcb
description: >
  Load before any electronics/PCB work with pcb_* tools — schematics, PCB layout,
  tscircuit TSX, Circuit JSON diagnostics, DRC, Gerber, BOM, CPL/Pick & Place,
  part search/catalog, footprints, routing, or viewer diagnostics. Not for mechanical
   FDM CAD (studio-cad) or firmware (studio-fw).
license: proprietary
compatibility: opencode
---

# PCB Studio

Load before `pcb_*` work. Do not load `studio-cad`. UI: `/studio` (not `/`).
Projects live under `$STUDIO_HOME/studio/circuits/<id>/src/circuit.tsx`.
Any source edit invalidates build, SVG, Gerber, BOM, and CPL — rebuild before claiming readiness.

## Loop

1. `pcb_workspace_list` + `pcb_catalog_list` once.
2. `pcb_project_create` unless an id already covers the work. Edit `src/circuit.tsx`.
3. Author with `pcb_tsx_snippet` for a short stub. Use
   `pcb_tscircuit_reference` for pinned official element/footprint details. The
   reference is syntax guidance only; runtime compatibility warnings and this
   skill's readiness gates remain authoritative. Do not search `node_modules`,
   tscircuit source, or `.d.ts` files.
4. Search once per part class. Use `pcb_component_add` on one returned `candidateId`;
   import only after its smoke test passes. Do not run npm, inspect `node_modules`,
   or repeat searches with synonyms. `footprintOnly` and
   `catalogOnly` are not wired parts. For an exact JLCPCB `C` number, use
   `pcb_component_import`; it stages, smoke-tests, fingerprints, and rolls back
   failures. No verified implementation → placeholder + keepout.
5. Build after each stage (`pcb_circuit_build`). Fix placement DRC; do not disable it.
   Use `actionableDiagnostics` first; query exact remaining types with
   `pcb_circuit_read`, not full Circuit JSON. Use `pcb_circuit_check` for bounded
   netlist, placement, or shorts checks when diagnostics need deeper evidence.
6. User-facing parts (battery, switch, LED, programming header) stay on top unless asked.
7. Export schematic + PCB, then inspect both with `pcb_schematic_svg` and
   `pcb_pcb_svg`. They return bounded PNG previews.
8. Export Gerber/CPL only when the matching ready flag is true. After a verified MPN,
   `pcb_catalog_upsert`. Footprint mismatch = local re-place, not a redesign.

## Ready

Do not collapse these. Quote blockers; do not invent clearance.

| Claim | Requires |
| --- | --- |
| good build | `success` and `designValid` |
| fab / Gerber | `fabricationReady` |
| assembly / CPL | `assemblyReady` |

`debugOnly` is not production. Tools do not prove electrical correctness.
The PCB agent has no Bash permission. Use only `pcb_*`, file editing, and stock
read tools; never attempt shell or `node_modules` fallbacks.

## Spec

When fab status is known, `pcb_spec` writes `SPEC.json`. CAD/FW read that file
with stock `read` — not `pcb_*`. `blocked` = not fab-ready. Rebuild + `pcb_spec`
again after source edits.
