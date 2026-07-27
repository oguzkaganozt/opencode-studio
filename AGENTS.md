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
bun run serve                                     # host @ 127.0.0.1:4173
bun run dev:ui                                    # Vite :5173, proxies /api → :4173
# CLI background (Linux): opencode-studio service install|status|stop|uninstall
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
- CAD/PCB **data** roots default to the domain workspace (`serve --workspace` / OpenCode `context.directory`), not the config home. `roots.<id>` must be **absolute**.
- Global `npm i -g` / `bun add -g` **postinstall** runs `repair` once (soft; never fails install): managed skills under `~/.config/opencode/skills/<id>-studio/` (marker `.opencode-studio-managed.json`), plugin + media-go **without version pins**, platform `media` skill, MCP `build123d`. Does **not** write into project directories. Skip: `OPENCODE_STUDIO_SKIP_POSTINSTALL=1` or `OPENCODE_STUDIO_SKIP_CONFIGURE=1`.
- `opencode-studio repair` and UI **Repair install** / `PUT /api/config` re-run the same install (loopback + CSRF). **`serve` does not repair.** Restart **OpenCode** after install so plugins/skills load.
- Overrides for tests/isolation: `OPENCODE_STUDIO_CONFIG_HOME`, `OPENCODE_CONFIG_HOME` (absolute).
- Do not hand-edit managed skills; unmarked or user-modified skills cause configure conflicts. `remove` **uninstalls** managed plugins/skills/MCP from OpenCode home (not the npm package).
- Host bind modes: `serve --local` (default, `127.0.0.1`) or `serve --web` (`0.0.0.0`). Web mode requires `OPENCODE_STUDIO_PASSWORD` at startup. The integrated agent lazily starts one loopback OpenCode sidecar per host (or attaches via `OPENCODE_STUDIO_OPENCODE_URL`) and pins requests to `serve --workspace`. Native OpenCode HTTP/SSE/WebSocket traffic from an owned sidecar is proxied at `/`; Studio lives at `/studio`. The Studio Agent panel is a same-origin iframe of that native UI (lazy on first open, stays mounted). Native proxying and the embedded Agent UI are disabled in attach mode to prevent shared-server event leakage — use the external server’s own URL. All Studio HTTP writes use CSRF + Origin checks. Non-loopback native OpenCode access uses HTTP Basic (username `opencode-studio`); domain studio read APIs remain public on loopback; /api/files requires Basic auth off-loopback. Never run as root unless `OPENCODE_STUDIO_ALLOW_ROOT=1`; TLS and multi-user authorization remain out of scope.

## Hard rules

- **No cross-studio imports.** Shared behavior only in `src/core/` when ≥2 studios need it.
- Tool names must not collide across studios; `provider`/`auth` hooks are singletons (media-go is the only auxiliary plugin export).
- New studio: `bun run create-studio <id>` scaffolds only — still register in `registry.ts`, `studios.ts`, `studio-loaders.ts` (plugin + API), and `ui/app.tsx` (`viewerLoaders`). See `docs/new-studio.md`.
- Changing tools or packaged skills: update `test/parity/tools.json` and/or `test/parity/skill-digests.json` or parity tests fail.
- Domain agent workflows live in `studios/*/skill/SKILL.md` (copied into `~/.config/opencode/skills/` on configure). Prefer those over inventing tool flows.
- Viewer CSS: Vite root is `ui/`, so Tailwind only auto-scans `ui/**`. `ui/styles.css` registers `@source "../studios"` and each studio `styles.css` carries `@source "."` — keep both when adding a studio or its utilities silently never generate.
- Viewer framing: `.studio-shell` is `flex min-h-dvh flex-col`; studio viewer roots must be `flex-1 min-h-0` (files explorer uses flex-1 min-h-0). Never `h-full`/`min-h-screen` on viewer roots and never style `.studio-shell` from studio CSS — that breaks the height chain.
- CAD forge runs from XDG cache (`ensureForgeRuntimeDir`), not in-package; source is `studios/cad/forge/` (Python, excluded from tsc/biome). Example designs live under `studios/cad/designs/`; organic benchmark under `studios/cad/benchmarks/` (both excluded from biome; required by `bun run test:python`).
- PCB authoring fixtures under `studios/pcb/authoring/` are excluded from tsc/biome. Domain engines ship with the package: `ffmpeg`/`ffprobe` (static), `tsci` (`tscircuit`), `uv` (downloaded to XDG cache on first use). Engines are not gated by config.
- Exports: `.` plugin, `./media-provider`, `./media-go`. Build entrypoints in `scripts/build.ts`; do not commit `dist/`.

## Verify before done

Prefer `bun run check` for code changes. Touching forge Python → also `bun run test:python`. Release-shaped changes → `bun run release:check`.

## Docs

- `docs/architecture.md` — surfaces and URL namespaces
- `docs/new-studio.md` — add-a-studio checklist
