# PCB Studio — Simulation Layer Plan

## Goal
Close the "does the circuit actually work?" gap: derive a SPICE netlist from a built tscircuit project, run analyses, and return waveforms the agent can read and the viewer can plot.

## Scope (v1)
- DC operating point + transient analysis via ngspice.
- Netlist generation from the built project's `circuit.json`.
- Probe node voltages / currents; numeric waveform data back to the agent.
- Waveform rendering: SVG attachment for the agent + a "Sim" tab in the viewer.
- Out of scope v1: AC sweep, signal integrity, power integrity.

## Engine
- `ngspice`, downloaded once into XDG cache on first use — same pattern as `uv` in `src/core/engines.ts` (new `EngineId: "ngspice"`, source `cache`).
- Raw output parsed to JSON/SVG in-process.

## Tools (`pcb_sim_*` prefix)
- `pcb_sim_netlist` — generate SPICE netlist from `projectId` (`circuit.json` → nodes/components).
- `pcb_sim_run` — run analysis (`dc | transient`) with probes and time window.
- `pcb_sim_probe` — read waveform values as numbers (agent feedback loop).
- `pcb_sim_plot` — render waveform SVG (attachment + viewer).
- Source: `studios/pcb/sim/netlist.ts` (json→netlist), `sim/ngspice.ts` (run/parse), `sim/waveform.ts` (SVG).

## Component models
`circuit.json` rarely carries SPICE models — fallback chain: workspace catalog `parts/*.yaml` `simModel` field → agent-supplied behavioral models → explicit error listing missing models. Never invent models silently.

## Viewer
"Sim" tab in the PCB viewer: waveform plot + probe list, reading `sim/results/<name>.json` from the project dir.

## External tools (surveyed 2026-08)

| Tool | Role in plan | License | ⭐ | Activity |
| --- | --- | --- | --- | --- |
| `tsci simulate analog` | v1 core — full pipeline (already bundled) | MIT | 2.485 (tscircuit) | very active |
| `circuit-json-to-spice` | v1 netlist generation (circuit.json → SPICE) | MIT | 2 | active |
| `ngspice` | v1 engine (native binary, cache download) | BSD-3 | 263 (mirror) | active (sourceforge) |
| `EEcircuit-engine` | v1 engine alt (ngspice-WASM, no binary) | MIT | 14 | active |
| `spicey` | v1 engine alt (native JS SPICE) | MIT | 2 | slow |
| `spice-ts` | engine alt (TS-native + ngspice-WASM backend) | MIT | 21 | slow |
| `KiCad-Spice-Library` | v1 model source (~50k models, external, never bundled) | GPL-3.0 | 418 | active-ish |
| `webgl-plot` | v1 viewer waveform plotting | MIT | 662 | active |
| `gerber2ems` | later — signal integrity (Gerber → openEMS) | Apache-2.0 | 250 | active |
| `openEMS` | later — FDTD EM solver (gerber2ems engine) | GPL-3.0 | 708 | active |

## Conventions (shared with CAD sim)
- Results written as JSON under `<project>/sim/`.
- Results carry a "directional estimate, not engineering-grade" caveat.
- Engine downloads use the existing `src/core/engines.ts` cache pattern.
- No shared runtime, engine, or module between the two layers — each is independent.

## Wiring
- `src/core/registry.ts` — add `pcb_sim_*` to `STUDIO_TOOL_PERMISSIONS.pcb`.
- `studios/pcb/agent/studio-pcb.md` — add `pcb_sim_*: allow`.
- Register tools in `studios/pcb/tools.ts`.
- `src/core/engines.ts` — resolver + cache download.

## Rollout
1. Netlist + DC/transient + numeric probe (agent loop works headless).
2. Waveform SVG + viewer Sim tab.
3. AC analysis.

## Risks
- **Model coverage (biggest)** — mitigation: model catalog + explicit failure, no silent substitutes.
- ngspice convergence vs. ideal tscircuit parts — document limits; mark results as estimates.

## Note
- **lcapy** (symbolic circuit analysis, LGPL-2.1) — not used in v1; noted only as a potential later option if closed-form/symbolic analysis is ever requested.