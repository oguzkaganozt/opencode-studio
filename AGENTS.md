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
| `studios/<id>/` | Domain: `studio.ts`, `plugin.ts`, `api.ts`, `tools.ts`, `skill/`, `viewer/`, `test/` |
| `ui/` | Shared Viewer shell (`app.tsx`); lazy-loads `@studios/<id>/viewer` |
| `test/parity/` | 4 frozen fixtures: `tools.json`, `skill-digests.json`, `plugin-hooks.json`, `source-commits.json` |

Catalog IDs (`src/core/registry.ts`): `cad` \| `media` \| `pcb` \| `startup`. Order is composition order.

Paths: `@/*` → `src/*`, `@studios/*` → `studios/*`, `@ui/*` → `ui/*` (tsconfig + Vite). Viewer tokens: single source `ui/tokens.css` — import via `@import "@ui/tokens.css"`; do not copy into studios. Shared viewer UI primitives live under `ui/components/` and `ui/lib/` — import via `@ui/…`; no cross-studio imports.

## Config (fail-closed) — config global, data local

- Studio enablement: `~/.config/opencode-studio/studio.json` → `{ "enabled": ["cad", "pcb"] }`. Missing/invalid → **no** studios.
- Optional `roots.<id>` must be **absolute** paths. Media default root is XDG user-data (`~/.local/share/opencode-studio/media`).
- CAD/PCB/startup **data** roots default to the domain workspace (`serve --workspace` / OpenCode `context.directory`), not the config home.
- `opencode-studio configure …` writes managed skills under `~/.config/opencode/skills/<id>-studio/` (marker `.opencode-studio-managed.json`), pins the plugin (+ media-go) in `~/.config/opencode/opencode.json`, and (when cad enabled) manages MCP key `build123d`. Does **not** write into project directories.
- Overrides for tests/isolation: `OPENCODE_STUDIO_CONFIG_HOME`, `OPENCODE_CONFIG_HOME` (absolute).
- After configure via home UI Apply: host hot-reloads studio APIs; restart **OpenCode** only. CLI `configure` does not notify a running host — restart serve too (or Apply from the UI).
- Do not hand-edit managed skills; unmarked or user-modified skills cause configure conflicts. `remove` clears **user-global** enablement.
- Host is loopback-only by default. The integrated agent lazily starts one loopback OpenCode sidecar per host (or attaches via `OPENCODE_STUDIO_OPENCODE_URL`) and pins requests to `serve --workspace`. Native OpenCode HTTP/SSE/WebSocket traffic from an owned sidecar is proxied at `/`; Studio lives at `/studio`. Native proxying is disabled in attach mode to prevent shared-server event leakage. All Studio HTTP writes use CSRF + Origin checks. Non-loopback agent and native OpenCode access additionally require `OPENCODE_STUDIO_PASSWORD`; read-only studio APIs remain public. Never run as root unless `OPENCODE_STUDIO_ALLOW_ROOT=1`; TLS and multi-user authorization remain out of scope.

## Hard rules

- **No cross-studio imports.** Shared behavior only in `src/core/` when ≥2 studios need it.
- Tool names must not collide across studios; `provider`/`auth` hooks are singletons (media-go is the only auxiliary plugin export).
- New studio: `bun run create-studio <id>` scaffolds only — still register in `registry.ts`, `studios.ts`, `studio-loaders.ts` (plugin + API), and `ui/app.tsx` (`viewerLoaders`). See `docs/new-studio.md`.
- Changing tools or packaged skills: update `test/parity/tools.json` and/or `test/parity/skill-digests.json` or parity tests fail.
- Domain agent workflows live in `studios/*/skill/SKILL.md` (copied into `~/.config/opencode/skills/` on configure). Prefer those over inventing tool flows.
- Viewer CSS: Vite root is `ui/`, so Tailwind only auto-scans `ui/**`. `ui/styles.css` registers `@source "../studios"` and each studio `styles.css` carries `@source "."` — keep both when adding a studio or its utilities silently never generate.
- Viewer framing: `.studio-shell` is `flex min-h-dvh flex-col`; studio viewer roots must be `flex-1 min-h-0` (media uses `flex: 1 1 auto`). Never `h-full`/`min-h-screen` on viewer roots and never style `.studio-shell` from studio CSS — that breaks the height chain.
- CAD forge runs from XDG cache (`ensureForgeRuntimeDir`), not in-package; source is `studios/cad/forge/` (Python, excluded from tsc/biome). Example designs live under `studios/cad/designs/`; organic benchmark under `studios/cad/benchmarks/` (both excluded from biome; required by `bun run test:python`).
- PCB authoring fixtures under `studios/pcb/authoring/` are excluded from tsc/biome. Domain engines ship with the package: `ffmpeg`/`ffprobe` (static), `tsci` (`tscircuit`), `uv` (downloaded to XDG cache on first use). Studio enable/disable does not install engines.
- Exports: `.` plugin, `./media-provider`, `./media-go`. Build entrypoints in `scripts/build.ts`; do not commit `dist/`.

## Verify before done

Prefer `bun run check` for code changes. Touching forge Python → also `bun run test:python`. Release-shaped changes → `bun run release:check`.

## Docs

- `docs/architecture.md` — surfaces and URL namespaces
- `docs/new-studio.md` — add-a-studio checklist
