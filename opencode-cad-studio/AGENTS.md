# Repository Guide

## Architecture Boundaries

- `src/plugin.ts` exposes lifecycle tools (`design_create/list/read/build/view`); geometry modeling, fit, printability, and rendering belong to the external `build123d-mcp`, not new plugin tools.
- `forge/forge_cli.py` is the canonical artifact builder. Each `parts/*.py` must expose `build()` returning exactly one valid build123d solid. Forge re-imports STEP and rejects validity, volume, solid-count, or bounds drift before publishing outputs.
- The filesystem is the integration bus: Forge writes; `src/server.ts` scans on demand. Do not add a database, job queue, or websocket layer without a demonstrated need.
- `ui/` is a React 19 + Vite + React Router + TanStack Query + Tailwind CSS 4 Viewer with OSC tokens and a lazy Three.js assembly canvas. Vite serves it from `ui/`, builds to `dist/ui/`, and proxies `/api` to the companion on port 4173.

## Generated Files

- Never edit `dist/`, `designs/*/{step,stl,glb,renders}`, `designs/*/manifest.json`, or `.artifacts/` directly.
- Forge publishes atomically under `.artifacts/<generation>` and points `step/`, `stl/`, `glb/`, and `manifest.json` symlinks at `.artifacts/current`; failed builds must preserve the previous generation.
- Build success proves canonical artifact integrity only. Assembly fit, printability, motion, and visual QC still require build123d-mcp checks described in `skills/cad-studio/SKILL.md`.

## Setup and Verification

```bash
bun install
uv sync --project forge
bun run check          # typecheck -> TS tests -> Python tests -> lint -> runtime/UI build
bun run release:check  # full check plus packed-consumer smoke test
```

- Focus one Bun test file with `bun test test/plugin.test.ts`.
- Focus one Python test with `uv run --project forge python -m unittest forge.tests.test_forge_cli.BuildDesignTest.test_builds_design_in_place -v`.
- Biome intentionally excludes `docs/`, `forge/`, and `designs/`; `bun run lint` does not validate Python or documentation.
- Run `bun run test:package` after changing exports, package contents, CLI lifecycle, or built assets. The smoke test intentionally rejects packaged `AGENTS.md`, source, tests, docs, and development paths.

## Local Runtime

- Root `opencode.json` loads `./src/plugin.ts`, repo-local `./forge`, and pinned `build123d-mcp@0.3.77`; use it for source development.
- Production-style companion: run `bun run build` before `bun run serve` because the server serves `dist/ui`.
- UI development needs both `bun run serve` on 4173 and `bun run dev:ui` on 5173.
- The companion has no authentication; keep it on localhost or a trusted VPN.
- OSC identity lives in `opencode-studio.json`. Lifecycle is `install` / `remove` / `doctor`; Companion requires `serve --root <existing path>`.

## Skill and Session Gotchas

- `skills/cad-studio/SKILL.md` is packaged source, but OpenCode uses the installed copy under `${XDG_CONFIG_HOME:-~/.config}/opencode/skills/cad-studio/` with `.osc-managed.json`. After changing it, run `bun src/cli.ts install` and restart OpenCode.
- A stale globally installed `cad-studio` skill can shadow the repo skill during E2E tests. Refresh with `install` (managed only) or isolate via `XDG_CONFIG_HOME` / `--config-home`.
- Unmarked or user-modified skills refuse overwrite; reclaim or remove them before reinstalling.
- OpenCode config and plugin modules are loaded once; restart OpenCode after changing `opencode.json`, the plugin, or the skill.
