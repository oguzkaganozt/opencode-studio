# PCB Studio — Simulation Layer Plan

## Goal
Close the "does the circuit actually work?" gap: run the analog experiments declared in tscircuit, return named probe feedback to the agent, and show simulation separately from fabrication/assembly readiness.

## Scope (v1)
- Transient analysis through tscircuit's ngspice engine.
- Named voltage/current probes; sampled values plus full-series summaries back to the agent.
- A separate Simulation viewer tab with waveforms and probe summaries.
- Shared source/build context with the PCB workflow, but independent `simulationSuccess`; simulation never changes fabrication/assembly flags.
- Out of scope v1: AC sweep, signal integrity, power integrity.

## Engine
- `tscircuit@0.0.2306` provides `tsci simulate analog` and its ngspice engine; no separate binary download or new `EngineId` is required.
- Simulation output is parsed to JSON/SVG in-process.

## Tools (`pcb_sim_*` prefix)
- `pcb_sim_netlist` — optional later inspection tool; tscircuit already generates the SPICE netlist internally.
- `pcb_sim_run` — run the `<analogsimulation>` declared in `src/circuit.tsx` and return probe series.
- `pcb_sim_probe` — folded into `pcb_sim_run`: named series include sampled values plus full-series min/max/mean/first/last/peak-to-peak summaries.
- `pcb_sim_plot` — not a separate model tool in v1; the Simulation viewer renders returned series.
- Source: `studios/pcb/tsci.ts` (run/extract/budget), `studios/pcb/tools.ts` (agent tool), and PCB viewer Simulation tab.

## Component models
Verified models are stored on exact workspace catalog MPNs as self-contained `.SUBCKT` source, credential-free HTTPS provenance, complete top-level pin mapping, and SHA-256. Manufacturer sources may retain helper subcircuits, but multi-subcircuit sources require an explicit top-level selection and that selected block is normalized first for tscircuit runtime compatibility. `pcb_spice_model_get` returns a tscircuit `<spicemodel>` snippet; `pcb_spice_model_upsert` rejects external includes, command directives, incomplete mappings, ambiguous model selection, unsupported top-level parameters, and unregistered MPNs. Never invent or silently substitute a model.

## Viewer
"Simulation" tab in the PCB viewer: named waveform plots + full-series summaries. It shows only simulation state and explicitly does not imply fabrication or assembly readiness.

## External tools (surveyed 2026-08)

| Tool | Role in plan | License | ⭐ | Activity |
| --- | --- | --- | --- | --- |
| `tsci simulate analog` | v1 core — full pipeline (already bundled) | MIT | 2.485 (tscircuit) | very active |
| `circuit-json-to-spice` | upstream netlist generation used by tscircuit | MIT | 2 | active |
| `ngspice` | v1 engine, provided through tscircuit's engine package | BSD-3 | 263 (mirror) | active (sourceforge) |
| `EEcircuit-engine` | v1 engine alt (ngspice-WASM, no binary) | MIT | 14 | active |
| `spicey` | v1 engine alt (native JS SPICE) | MIT | 2 | slow |
| `spice-ts` | engine alt (TS-native + ngspice-WASM backend) | MIT | 21 | slow |
| `KiCad-Spice-Library` | v1 model source (~50k models, external, never bundled) | GPL-3.0 | 418 | active-ish |
| `webgl-plot` | optional later renderer for very dense traces; v1 uses lightweight SVG | MIT | 662 | active |
| `gerber2ems` | later — signal integrity (Gerber → openEMS) | Apache-2.0 | 250 | active |
| `openEMS` | later — FDTD EM solver (gerber2ems engine) | GPL-3.0 | 708 | active |

## Conventions (shared with CAD sim)
- Results carry a "directional estimate, not engineering-grade" caveat.
- External engine downloads, if introduced later, use the existing `src/core/engines.ts` cache pattern.
- No shared runtime, engine, or module between the two layers — each is independent.

## Wiring
- Existing `pcb_*` permission already includes `pcb_sim_run`; no new permission selector is needed.
- Register tools in `studios/pcb/tools.ts`.
- Existing `tsci` resolver remains the only v1 engine wiring.

## Rollout
1. Align scaffold/fallback tscircuit versions and verify the official fixture.
2. `pcb_sim_run`: transient experiments + named probe summaries (agent loop works headless).
3. Separate Simulation API/viewer tab.
4. Later: AC analysis and model-catalog expansion.

## Risks
- **Model coverage (biggest)** — mitigation: model catalog + explicit failure, no silent substitutes.
- ngspice convergence vs. ideal tscircuit parts — document limits; mark results as estimates.
- Model-independent power/IR-drop/decoupling checks are deferred until the source contains explicit current, tolerance, and trace-resistance inputs; do not infer them from incomplete Circuit JSON.

## Note
- **lcapy** (symbolic circuit analysis, LGPL-2.1) — not used in v1; noted only as a potential later option if closed-form/symbolic analysis is ever requested.
