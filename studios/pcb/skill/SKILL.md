---
name: studio-pcb
description: >
  Load before any electronics/PCB work with pcb_* tools — schematics, PCB layout,
  tscircuit TSX, Circuit JSON diagnostics, DRC, Gerber, BOM, CPL/Pick & Place,
  part search/catalog, footprints, routing, or viewer diagnostics. Not for mechanical
  FDM CAD (studio-cad) or workspace image/audio/video generation (studio-media).
license: proprietary
compatibility: opencode
---

# PCB Studio

Use PCB Studio for electronic schematics and PCB layouts. Load this skill before
`pcb_*` product work. Do not load `studio-cad` (mechanical/FDM) or `studio-media`
(workspace media generation).

Studio UI: `http://127.0.0.1:4173/studio` (not bare `/`, which is native OpenCode).
PCB domain root defaults to `$STUDIO_HOME/studio/circuits` (projects as
`circuits/<id>/` with `src/circuit.tsx`; optional catalog at `circuits/catalog/parts/`).
UI and tools only discover projects under that root. The viewer can send diagnostics
to the Agent panel; treat that draft as user intent, then fix with tools below.

Any TSX/source change invalidates prior build, SVG, Gerber, BOM, and CPL claims —
rebuild (and re-export if needed) before asserting readiness.

## Workflow

1. Call `pcb_workspace_list` and `pcb_catalog_list` once before authoring.
   The catalog is workspace-local (`catalog/parts/*.yaml`). Missing/empty is fine
   on a new Studio Home; create entries after parts are verified (see step 8).
2. New project: `pcb_project_create` (name/directory) unless an existing id already
   covers the work. Then edit `src/circuit.tsx`.
3. Lock part **classes**, not part numbers, during design. For every part record
   the footprint family, value, pinout, and whether each complex device is a
   module or bare IC. A part class is **standard and buyable** when all three
   hold: (a) the package is a nameable IPC/JEDEC family (0603, 0805, SOIC-8,
   SOT-23-5, 2.54mm header — not a vendor-specific pad layout), (b) the value is
   a standard E-series value (10/22/33/47/100/330/470/1k/10k/100k; 1n/10n/100n/
   1µ/10µ), and (c) one `pcb_component_search` with `source: "jlcpcb"` for that
   package+value returns `supplierPartNumbers`. If all three hold, design with
   the class and **do not hunt MPN variants** — one search per part class is
   enough; repeated searches to "find the best match" do not improve the layout.
   Only parts that fail the test (exotic value/package, or footprints that only
   exist as an LCSC-bound part record, e.g. `jlcpcb:C...` footprints) need the
   exact part searched during design — for those, treat search results as
   candidates, not catalog approval.
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
4. Build incrementally: board and power, MCU, peripherals, then placement and
   routing. Run `pcb_circuit_build` after each meaningful stage.
   For circuits containing `<analogsimulation>` and probes, run `pcb_sim_run`
   and use its numeric series to verify electrical behavior. Simulation success
   does not imply `designValid`, fabrication readiness, or assembly readiness.
   Declare `<analogsimulation spiceEngine="ngspice" ... />` when the experiment
   needs the ngspice engine: the default spicey engine emits only voltage
   probes, so current probes require ngspice and otherwise return empty series.
   Keep results as directional estimates, not engineering-grade.
5. After the first build, make targeted edits instead of rewriting the entire
   `src/circuit.tsx`. Read locally installed tscircuit source and types before
   broad web research.
6. Use compact build diagnostics first. For complete records, call
   `pcb_circuit_read` with the exact error type in `types`; do not fetch full
   Circuit JSON unless necessary. Fix placement errors rather than disabling
   placement DRC.
7. Use schematic and PCB SVG exports to debug incomplete designs. Gerber and
   CPL are blocked while placeholders, unverified complex part identities,
   supplier footprint mismatches, unconnected non-`noConnect` pins, incomplete
   BOM identity, or missing/malformed placements remain.
8. Resolve exact MPNs at BOM finalization, after the design is validated. For
   each part class from step 3, run one `pcb_component_search` for the MPN and
   accept it only when its footprint matches the routed footprint and its specs
   meet the design value. Prefer `pcb_catalog_get` when the MPN is already
   catalogued. After a BOM line has a **verified** exact MPN (and optional
   manufacturer / description / datasheet), promote it with `pcb_catalog_upsert`
   so later boards reuse metadata via `pcb_catalog_list` / `pcb_catalog_get`.
   Do not upsert placeholders, guessed MPNs, or supplier-only identities without
   an MPN. The viewer BOM can also “Add to catalog” for the same write path.
   A footprint mismatch found here is a localized re-place, not a redesign:
   rebuild, re-verify, re-export.
9. Treat electrical simulation as a parallel feedback axis. After relevant
   source changes, run `pcb_circuit_build` for design/manufacturing diagnostics
   and `pcb_sim_run` for electrical behavior. Use both to iterate, but never
   infer `fabricationReady`/`assemblyReady` from simulation success or infer
   electrical correctness from production readiness.
10. For a real MOSFET, diode, op-amp, regulator, or driver whose behavior matters
    to the experiment, check the exact catalog MPN with `pcb_spice_model_get`.
    If missing, obtain a self-contained model from the manufacturer or another
    explicitly trusted HTTPS source, verify every top-level model pin against the
    datasheet and tscircuit chip pin labels, then store it with
    `pcb_spice_model_upsert`. Preserve required helper `.SUBCKT` blocks and pass
    the intended top-level `subcircuit` name whenever the source contains more
    than one; never guess it from naming alone.
    Apply the returned `<spicemodel>` snippet in `src/circuit.tsx`; never silently
    substitute a generic model, auto-map pins, or treat a community archive as
    manufacturer verification. Report model source URL and SHA-256 when citing
    simulation results. If no trustworthy model exists, narrow the simulated
    subcircuit and state which component behavior was not modeled.

## Worked micro-flow (first board)

Typical loop for a new project (names are illustrative):

1. `pcb_workspace_list` → note empty or existing project ids under the domain root.
2. `pcb_project_create` with a name (and optional directory) → then edit
   `src/circuit.tsx` (board outline, nets, power, then MCU). Skip create if the
   project already exists.
3. `pcb_circuit_build` with the project id → read `success`, `designValid`,
   `fabricationReady`, `assemblyReady`, `manufacturingBlockers`, and
   `assemblyBlockers`.
4. If errors: `pcb_circuit_read` filtered by error `types` → targeted TSX edit →
   rebuild. Prefer one stage at a time over a full rewrite.
5. When `designValid` is true but fab/assembly is false, clear blockers (placeholders,
   missing MPN, unconnected pins) before exporting Gerber/CPL.
6. Export only after readiness matches the claim you will make (see table below).
7. Open Studio PCB viewer (`/studio` → PCB) to confirm schematic/PCB previews.
   If the user sent diagnostics via **Send diagnostics to agent**, treat that text
   as the current defect list and re-run build after fixes.
8. For each verified MPN not yet in the catalog, call `pcb_catalog_upsert` (or use
   BOM **Add to catalog**) so the next project can resolve metadata without a
   fresh supplier search.

## Readiness field table

Tools return separate axes. Never collapse them into a single “done”.

| Field | Meaning | When false / incomplete |
| --- | --- | --- |
| `success` | Process finished and `designValid` is true (build tools) | Treat as blocked; do not claim a good build |
| `designValid` | Circuit JSON has zero design errors | Hard incomplete; fix diagnostics first |
| `errorCount` / `warningCount` | Compact diagnostic totals | Errors block validity; warnings need explicit callout |
| `fabricationReady` | No manufacturing blockers (placeholders, identity, fab pins, etc.) | Do not claim Gerber/fab readiness |
| `assemblyReady` | Fab-ready, BOM complete, and all non-DNP parts have valid placements | Do not claim pick-and-place / assembly readiness |
| `manufacturingBlockers` | Why fab is blocked | Quote these; do not invent clearance |
| `assemblyBlockers` | Why assembly is blocked (fab, BOM, and placement blockers) | Clear every blocker before CPL/assembly claims |
| `debugOnly` | Build useful for debug only (invalid design) | Never present as production-ready |
| `bomComplete` (BOM tools) | Every BOM line has an MPN where required | Blocks `assemblyReady` |

Stop claiming X when Y is false: good build needs `success`+`designValid`; fab needs
`fabricationReady`; assembly needs `assemblyReady`. Quote `manufacturingBlockers`
and `assemblyBlockers`.

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
- Claim a simulation only if `pcb_sim_run.success` is true and named experiments
  contain probe series. Report missing models/convergence errors explicitly.
- A successful simulation proves only the declared model and stimulus. It does
  not prove the physical part, firmware, RF behavior, thermal behavior, or board.
