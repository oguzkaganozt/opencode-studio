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
3. Author with `pcb_tsx_snippet` for tag/pin shape. Do not search `node_modules`,
   tscircuit source, or `.d.ts` files.
4. Search once per part class. Use `pcb_component_add` on one returned `candidateId`;
   import only after its smoke test passes. Do not run npm, inspect `node_modules`,
   or repeat searches with synonyms. `footprintOnly` and
   `catalogOnly` are not wired parts. No verified candidate → placeholder + keepout.
5. Build after each stage (`pcb_circuit_build`). Fix placement DRC; do not disable it.
   Read errors via `pcb_circuit_read` `types`, not full Circuit JSON.
6. User-facing parts (battery, switch, LED, programming header) stay on top unless asked.
7. Export Gerber/CPL only when the matching ready flag is true. After a verified MPN,
   `pcb_catalog_upsert`. Footprint mismatch = local re-place, not a redesign.

## Ready

Do not collapse these. Quote blockers; do not invent clearance.

| Claim | Requires |
| --- | --- |
| good build | `success` and `designValid` |
| fab / Gerber | `fabricationReady` |
| assembly / CPL | `assemblyReady` |

`debugOnly` is not production. Tools do not prove electrical correctness.

## Spec

When fab status is known, `pcb_spec` writes `SPEC.json`. CAD/FW read that file
with stock `read` — not `pcb_*`. `blocked` = not fab-ready. Rebuild + `pcb_spec`
again after source edits.
