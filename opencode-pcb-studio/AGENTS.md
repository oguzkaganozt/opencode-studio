# OpenCode PCB Studio — Agent Guide

Generic OpenCode plugin + companion web viewer for tscircuit PCB projects.

## Commands

```bash
bun run check       # typecheck + test + lint + build
bun run build       # build runtime (dist/) + UI (dist/ui/)
bun run dev:ui      # vite dev server for viewer UI
bun test            # single-file test runner (bun test)
bun src/cli.ts serve --root .        # OSC companion (read-only) on 127.0.0.1:4174
bun src/cli.ts install|remove|doctor # OpenCode lifecycle (OSC)
```

Plugin changes need `bun run build:runtime` (or `bun run build`) and an OpenCode
restart — the plugin is loaded from `dist/plugin.js`.

## Structure

- `src/plugin.ts` — 12 OpenCode tools (pcb_workspace_list, pcb_project_create,
  pcb_catalog_list/get, pcb_component_search, pcb_circuit_build/export/read,
  pcb_schematic_svg, pcb_pcb_svg, pcb_bom_generate, pcb_assembly_export)
- `src/server.ts` — Hono companion API + SPA serving
- `src/workspace.ts` — project discovery (any dir with `src/circuit.tsx`)
- `src/tsci.ts` — tsci CLI wrapper; circuit build/export
- `src/circuit-json.ts` — shared Circuit JSON parse, inspect, query; diagnostics
- `src/bom.ts` — Bill of Materials generation (groups by MPN/supplier identity, cross-refs catalog MPNs)
- `src/assembly.ts` — Pick & Place CPL CSV generation from pcb_component data
- `src/watcher.ts` — observation-only SSE (source/artifact changes; no Companion rebuilds)
- `src/lifecycle.ts` / `src/package-meta.ts` — OSC install/remove/doctor + manifest
- `src/catalog.ts` — part catalog reader (`catalog/parts/*.yml`)
- `src/scaffold.ts` + `src/templates.ts` — new-project scaffolding
- `opencode-studio.json` — OSC package identity (`plugin: ./server`)
- `ui/` — React SPA with OSC tokens + tscircuit schematic/PCB/3D viewers
- `authoring/` — example tscircuit project (wall-sconce-rev-a)

## Key facts

- **plugin format names** vs **tsci CLI format names**: the plugin tool
  `pcb_circuit_export` uses formats `schematic`, `pcb`, `gerber`; the underlying
  `tsci export` CLI uses `schematic-svg`, `pcb-svg`, `gerbers`.
- **Circuit validation**: `pcb_circuit_build` returns `designValid` and
  `diagnostics`. A zero process exit is insufficient — check
  `diagnostics.errors` and `manufacturingBlockers`; if non-empty, fix
  `src/circuit.tsx` and rebuild.
  `pcb_circuit_read` defaults to overview + diagnostics; use `types`/
  `offset`/`limit` to query specific element types.
- **Safe placeholders**: reserve unknown package space with a `keepout`,
  `pcbnoterect`, and a `pcbnotetext` starting with
  `PCB_STUDIO_PLACEHOLDER:`. Placeholder notes and unconnected pins block
  Gerber/CPL. Unverified complex-part identities and supplier
  footprint mismatches also block manufacturing; there is no agent-facing
  override.
- **Workspace scope**: the plugin always uses OpenCode's active
  `context.directory`; it has no workspace option. The Companion requires
  `serve --root PATH` (existing Data Root). `--workspace` is a deprecated alias.
- **Interact with tscircuit only through the tsci CLI** (`src/tsci.ts`); never
  import tscircuit internals or hand-edit generated output.
- **Generated output** (`dist/`, `build/`, `.tscircuit/`) is never tracked.
- **Tests** are in `test/studio.test.ts` (`bun test`, no separate test framework).
- **Keep the tool generic**: no project/product-specific policy in src/ or ui/.

## Known bottleneck

Component resolution, rather than raw part discovery, is the main authoring
bottleneck. Search can find an MPN, supplier code, and package description while
still lacking a verified, loadable tscircuit component or KiCad footprint; a
returned KiCad candidate can also fail later if the tscircuit footprint cache
does not contain it. Never treat JLCPCB `packageDescription` as a footprint or
substitute a parser-valid generic package. Verify that an implementation loads
and builds, otherwise use a manufacturing-blocking placeholder. The highest
value follow-up is a stateless MPN-to-loadable-component resolution check.
