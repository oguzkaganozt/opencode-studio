# AGENTS.md

Modular monolith: one npm package (`@oguzkaganozt/opencode-studio`), one CLI (`opencode-studio`), one host, one Viewer. Studios are source modules under `studios/`, not separate packages.

## Commands

```bash
bun install
bun test                                          # core + all studio tests
bun test path/to/file.test.ts                     # single file
bun run typecheck                                 # tsc --noEmit
bun run lint                                      # biome check
bun run build                                     # runtime (dist/) + UI (dist/ui/)
bun run check                                     # typecheck + test + lint + build
bun run release:check                             # full gate (CI)
bun run test:python                               # CAD forge (uv via PATH or package cache)
bun run test:browser:install                      # once: Playwright Chromium for UI smoke
bun run test:pcb-fixture                          # regenerate PCB authoring fixtures
bun run test:package                              # pack + verify shipped files
bun run test:browser                              # HTTP + Chromium layout/CSS smoke (needs dist/ui)
bun run dev:ui                                    # Vite :5173 (UI only)
# CLI (after build/global): status | repair | remove | upgrade
# Studio host: started by the ensure-host companion when `opencode serve` starts
# Internal server bring-up: v1-release-plan.md
```

CI (`.github/workflows/ci.yml`): `uv sync --locked --project studios/cad/forge` → `bun install --frozen-lockfile` → `bun run release:check`. Bun ≥ 1.3, Python 3.12 + uv for forge/MCP.

## Layout

| Path | Owns |
| --- | --- |
| `src/` | CLI (`cli.ts`), plugin, host HTTP, config, lifecycle |
| `src/core/` | Shared behaviors (engines, paths, security, plugin-compose, registry, MCP config, package meta) |
| `src/platform/media/` | Always-on media tools, provider hooks, Files API, `media` skill |
| `studios/<id>/` | Domain CAD/PCB: `studio.ts`, `plugin.ts`, `api.ts`, `tools.ts`, `skill/`, `viewer/`, `test/` |
| `ui/` | Shared Viewer shell (`app.tsx`); Files explorer + lazy `@studios/<id>/viewer` |
| `test/parity/` | 4 frozen fixtures: `tools.json`, `skill-digests.json`, `plugin-hooks.json`, `source-commits.json` |

Catalog IDs (`src/core/registry.ts`): `cad` \| `pcb`. Composition order: platform media first, then catalog order.

Paths: `@/*` → `src/*`, `@studios/*` → `studios/*`, `@ui/*` → `ui/*` (tsconfig + Vite). Viewer tokens: single source `ui/tokens.css` — import via `@import "@ui/tokens.css"`; do not copy into studios. Shared viewer UI primitives live under `ui/components/` and `ui/lib/` — import via `@ui/…`; no cross-studio imports.

## Config — always-on domains, config global, data local

- **CAD and PCB are always on** (full catalog). No enable/disable toggle. Platform media + Files stay on too.
- Optional `~/.config/opencode-studio/studio.json` holds **roots only**: `{ "roots": { "cad": "/abs", "pcb": "/abs" } }`. Missing file is fine. Legacy `enabled` is ignored.
- CAD/PCB **data** roots default under fixed Studio Home (`$HOME` or `OPENCODE_STUDIO_WORKSPACE`), not the OpenCode project directory:
  - CAD → `$STUDIO_HOME/studio/designs` (projects at `studio/designs/<id>/`)
  - PCB → `$STUDIO_HOME/studio/circuits` (projects at `studio/circuits/<id>/`, catalog at `studio/circuits/catalog/parts/`)
  - `roots.<id>` must be **absolute** domain roots (directory that directly contains project ids). Platform media remains OpenCode-project-scoped.
- Global install channel is **bun only** (`bun add -g @oguzkaganozt/opencode-studio`). npm registry is publish-only. **postinstall** on bun global runs `repair` once (soft): managed skills under `~/.config/opencode/skills/studio-<id>/` (`studio-cad`, `studio-pcb`, `studio-media`; marker `.opencode-studio-managed.json`), plugin + media-go **without version pins**, MCP `build123d`. Does **not** write into project directories. Skip: `OPENCODE_STUDIO_SKIP_POSTINSTALL=1` or `OPENCODE_STUDIO_SKIP_CONFIGURE=1`. `opencode-studio upgrade` → check npm → confirm (`-y` to skip) → stop serve+host → `bun add -g …@latest` → `repair` → start serve+host (bind/password from `OPENCODE_*` / `OPENCODE_STUDIO_*`). Restart env: caller env wins; missing keys filled from a snapshot of the previous stack (`ss` bind + `/proc/…/environ`).
- `opencode-studio repair` and `PUT /api/config` re-run the same install (loopback + CSRF). Restart **OpenCode** after install so plugins/skills load.
- Overrides for tests/isolation: `OPENCODE_STUDIO_CONFIG_HOME`, `OPENCODE_CONFIG_HOME` (absolute).
- Do not hand-edit managed skills; unmarked or user-modified skills cause configure conflicts. `remove` **uninstalls** managed plugins/skills/MCP from OpenCode home (not the npm package).
- **OpenCode-first host:** lifecycle is owned by `opencode serve`. Studio host starts via (1) `opencode-studio ensure-host` companion (PATH wrapper `~/.local/bin/opencode` installed on repair so `opencode serve` auto-starts host) and/or (2) plugin bootstrap when OpenCode loads the package. Studio Home is **`$HOME`** for the serve lifetime (explicit `OPENCODE_STUDIO_WORKSPACE` override); it never rebinds from sessions/directories. Agent proxy prefers client directory and falls back to fixed Studio Home. Studio **never** spawns OpenCode. Bind follows parent / `OPENCODE_STUDIO_*`; port `OPENCODE_STUDIO_PORT` (default 4173; busy fails, no ephemeral). Opt out: `OPENCODE_STUDIO_AUTOSTART=0`.

## Hard rules

- **Lean security only.** Keep the code streamlined. Ship **only** these host guards — nothing more:
  1. Loopback default; non-loopback bind needs Basic (`OPENCODE_SERVER_PASSWORD` or `OPENCODE_STUDIO_PASSWORD`) on routes (health may stay open). On loopback only, reject mismatched `Host` (DNS rebinding) — not a multi-user auth layer.
  2. CSRF + Origin on **writes** (browser session). Optional `OPENCODE_STUDIO_ALLOWED_ORIGINS` (comma-separated absolute origins) for reverse-proxy/dev only. Non-loopback also refuses HTTP config writes (`remote_config_disabled`); edit `studio.json` on the server.
  3. Refuse root unless `OPENCODE_STUDIO_ALLOW_ROOT=1`.
  Do **not** add multi-user IAM, TLS termination, rate limits, audit frameworks, extra auth layers, or “defense in depth” that OpenCode itself does not use. Prefer OpenCode’s model; firewall/network is ops, not app code. When in doubt, omit.
- **No cross-studio imports.** Shared behavior only in `src/core/` when ≥2 studios need it.
- Tool names must not collide across studios; `provider`/`auth` hooks are singletons (media-go is the only auxiliary plugin export).
- New studio: `bun run create-studio <id>` scaffolds only — still register in `registry.ts`, `studios.ts`, `studio-loaders.ts` (plugin + API), and `ui/app.tsx` (`viewerLoaders`).
- Changing tools or packaged skills: update `test/parity/tools.json` and/or `test/parity/skill-digests.json` or parity tests fail.
- Domain agent workflows live in `studios/*/skill/SKILL.md` (copied into `~/.config/opencode/skills/` on configure). Prefer those over inventing tool flows.
- Viewer CSS: Vite root is `ui/`, so Tailwind only auto-scans `ui/**`. `ui/styles.css` registers `@source "../studios"` and each studio `styles.css` carries `@source "."` — keep both when adding a studio or its utilities silently never generate.
- Viewer framing: `.studio-shell` is `flex min-h-dvh flex-col`; studio viewer roots must be `flex-1 min-h-0` (files explorer uses flex-1 min-h-0). Never `h-full`/`min-h-screen` on viewer roots and never style `.studio-shell` from studio CSS — that breaks the height chain.
- CAD forge runs from XDG cache (`ensureForgeRuntimeDir`), not in-package; source is `studios/cad/forge/` (Python, excluded from tsc/biome). Example design: `studios/cad/designs/box-lid-demo/`; organic benchmark fixture: `studios/cad/benchmarks/organic-shell/` (`target.py` + reference PNGs; required by `bun run test:python`).
- PCB authoring fixtures under `studios/pcb/authoring/` are excluded from tsc/biome. Domain engines ship with the package: `ffmpeg`/`ffprobe` (static), `tsci` (`tscircuit`), `uv` (downloaded to XDG cache on first use). Engines are not gated by config.
- Exports: `.` + `./server` (OpenCode 1.18 server entry), `./media-provider`, `./media-go`. Package must set `"main"` and/or `exports["./server"]` or OpenCode silently skips the plugin. media-go is registered as `file://…/dist/media-go.js` on configure (npm subpath is not a server entry). Build entrypoints in `scripts/build.ts`; do not commit `dist/`.

## Verify before done

Prefer `bun run check` for code changes. Touching forge Python → also `bun run test:python`. Release-shaped changes → `bun run release:check`.
