# CAD Studio — Simulation Layer Plan

## Goal
Close the "will the part/system work?" gap for mechanical projects (e.g. robot arms): verify joint structure, reach, load capacity, and repeated-use durability — not just single-part strength.

## Scope (v1) — layer stack, each layer feeds the next
1. **Assembly & joints** (no engine): parts, mates, joint types (revolute/fixed), joint axes, limits, DOF. Validates axis alignment, clearances, motion ranges.
2. **Kinematics** (in-process): workspace / reachability from joint limits, simple inverse kinematics for articulated chains (planar + revolute first).
3. **Loads** (in-process): worst-case pose + payload + acceleration → joint torques and reaction forces. Motor/torque verification against these; forces feed the analysis layer.
4. **Analytical FEA** (in-process, no solver): beam/plate approximations, simplified deflection and stress estimates, safety factors with material presets (PLA, ABS, aluminum, steel). Covers the decisions a prototype actually needs (sizing, material, motor choice).
5. **Fatigue report** (math on analysis results, ~zero cost): stress amplitude + cycle count vs. material endurance limit, simplified S-N/Goodman check → directional cycles-to-failure estimate. Report, not a gate.

Out of scope (v1): thermal, full fatigue FEA.

## Later (only when a real need appears)
- **Full solver FEA** (gmsh + ccx, downloaded once into XDG cache like `uv`): precise stress for production sign-off, not prototypes.
- **Dynamics** (time-based motion, physics engine e.g. pybullet).

## Engine
- All v1 layers: in-process Python in the existing `cad_runtime` worker (uv env) — no new binary; reuse selectors and session objects. Heavy deps imported lazily, like `augura` in `analyze_printability.py`.
- Full solver later: same engine pattern (`_budget.py` caps, subprocess isolation, no hangs).

## Tools (`cad_sim_*` prefix)
- `cad_sim_assembly` — define joints/mates between session parts; reports DOF, axes, limits.
- `cad_sim_kinematics` — workspace/reachability; simple IK for articulated chains.
- `cad_sim_loads` — pose + payload + acceleration → joint torques, reaction forces, motor check.
- `cad_sim_mass_properties` — volume, mass, COG, inertia with material/density.
- `cad_sim_analyze` — analytical stress/deflection + safety factor (solver-free).
- `cad_sim_fatigue` — cycle count + endurance-limit estimate (directional).
- `cad_sim_probe` — read result fields at a point (agent feedback loop).
- `cad_sim_render` — render result overlay (SVG/PNG + viewer layer).
- Source: `studios/cad/engine/cad_runtime/tools/studio_sim.py` (same request/response marshal pattern as existing tools).

## Viewer
"Results"/"Sim" layer in the CAD viewer: result overlay + legend, joint axes/limits visualization, reachable workspace outline. Results JSON under the project dir (`parts/<name>/sim/`).

## External tools (surveyed 2026-08)

| Tool | Role in plan | License | ⭐ | Activity |
| --- | --- | --- | --- | --- |
| `ikpy` | v1 kinematics / IK (pure Python, no engine) | Apache-2.0 | 1.025 | very active |
| `yourdfpy` | v1 bridge — assembly joints → URDF → ikpy | MIT | 293 | active |
| `scikit-fem` | v1 analytical FEA (in-process, numpy/scipy) | BSD-3 | 644 | active |
| `meshio` | v1 utility — mesh format conversion | MIT | 2.318 | active-ish |
| `gmsh` | later — full solver meshing | GPL-2.0 | — (GitLab) | very active |
| `CalculiX (ccx)` | later — full static FEA solver | GPL-2.0 | 202 | active |
| `pybullet` | later — dynamics | zlib | 14.671 | active |
| `MuJoCo` | later — dynamics | Apache-2.0 | 14.527 | very active |
| `pink` | IK alt — needs Pinocchio (heavy) | Apache-2.0 | 816 | active |
| `pyroki` | IK alt — JAX-based | MIT | 1.672 | active-ish |
| `pytorch_kinematics` | IK alt — needs PyTorch (heavy) | MIT | 817 | active |

## Conventions (shared with PCB sim)
- Results written as JSON under `<project>/sim/`.
- Results carry a "directional estimate, not engineering-grade" caveat.
- Engine downloads use the existing `src/core/engines.ts` cache pattern.
- No shared runtime, engine, or module between the two layers — each is independent.

## Wiring
- `src/core/registry.ts` — add `cad_sim_*` to `STUDIO_TOOL_PERMISSIONS.cad`.
- `studios/cad/agent/studio-cad.md` — add `cad_sim_*: allow`.
- Register tools in `studios/cad/tools/catalog.json` + `index.ts`.
- (Later) `src/core/engines.ts` — resolvers for `ccx` / `gmsh`.

## Rollout
1. Mass properties + assembly/joints (no engine, immediate).
2. Kinematics + loads (in-process; agent loop works headless).
3. Analytical FEA + fatigue report (still no new binary).
4. Viewer overlay.
5. Only if a real need appears: full solver FEA, then dynamics.

## Risks
- Kinematics generality — v1 limited to articulated revolute chains; document limits in tool output.
- Analytical approximations have validity bounds (simple beams/plates, small deflections) — state them in tool output; escalation path is the full solver.
- Material + fatigue presets are estimates — results are directional, stated in tool output.