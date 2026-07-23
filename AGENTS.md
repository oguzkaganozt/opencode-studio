# AGENTS.md

Modular monolith: one npm package (`opencode-studio`), one CLI, one host, one Viewer. Studios are source modules under `studios/`, not separate packages.

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
bun run test:python                               # CAD forge (needs uv)
bun run serve                                     # host @ 127.0.0.1:4173
bun run dev:ui                                    # Vite :5173, proxies /api → :4173
```

CI (`.github/workflows/ci.yml`): `uv sync --locked --project studios/cad/forge` → `bun install --frozen-lockfile` → `bun run release:check`. Bun ≥ 1.3, Python 3.12 + uv for forge/MCP.

## Layout

| Path | Owns |
| --- | --- |
| `src/` | CLI, plugin, host HTTP, config, lifecycle, composition (`core/`) |
| `studios/<id>/` | Domain: `studio.ts`, `plugin.ts`, `api.ts`, `tools.ts`, `skill/`, `viewer/`, `test/` |
| `ui/` | Shared Viewer shell; lazy-loads `@studios/<id>/viewer` |
| `test/parity/` | Frozen tool inventory, skill digests, hook policy |

Catalog IDs (`src/core/registry.ts`): `cad` \| `media` \| `pcb` \| `startup`. Order is composition order.

Paths: `@/*` → `src/*`, `@studios/*` → `studios/*` (tsconfig + Vite).

## Config (fail-closed)

- Project: `<workspace>/.opencode/studio.json` → `{ "enabled": ["cad", "pcb"] }`. Missing/invalid → **no** studios.
- Optional `roots.<id>` must be **absolute** paths. Media default root is XDG user-data (`~/.local/share/opencode-studio/media`), not the workspace.
- `opencode-studio configure …` also writes managed skills under `.opencode/skills/<id>-studio/` (marker `.opencode-studio-managed.json`), pins plugin entries in OpenCode config, and (when cad enabled) manages MCP key `build123d`.
- After configure: restart OpenCode **and** the studio host.
- Do not hand-edit managed skills; unmarked or user-modified skills cause configure conflicts.
- Host is loopback-only by default; CSRF + Origin on `PUT /api/config` only (studio APIs are read-only GETs). Never run as root unless `OPENCODE_STUDIO_ALLOW_ROOT=1`. Multi-user hosts are out of scope without additional auth.

## Hard rules

- **No cross-studio imports.** Shared behavior only in `src/core/` when ≥2 studios need it.
- Tool names must not collide across studios; `provider`/`auth` hooks are singletons (media-go is the only auxiliary plugin export).
- New studio: `bun run create-studio <id>` scaffolds only — still register in `registry.ts`, `studios.ts`, `studio-loaders.ts` (plugin + API), and `ui/app.tsx` (`viewerLoaders`). See `docs/new-studio.md`.
- Changing tools or packaged skills: update `test/parity/tools.json` and/or `test/parity/skill-digests.json` or parity tests fail.
- Domain agent workflows live in `studios/*/skill/SKILL.md` (copied into workspaces on configure). Prefer those over inventing tool flows.
- Viewer CSS: Vite root is `ui/`, so Tailwind only auto-scans `ui/**`. `ui/styles.css` registers `@source "../studios"` and each studio `styles.css` carries `@source "."` — keep both when adding a studio or its utilities silently never generate.
- Viewer framing: `.studio-shell` is `flex min-h-dvh flex-col`; studio viewer roots must be `flex-1 min-h-0` (media uses `flex: 1 1 auto`). Never `h-full`/`min-h-screen` on viewer roots and never style `.studio-shell` from studio CSS — that breaks the height chain.
- CAD forge runs from XDG cache (`ensureForgeRuntimeDir`), not in-package; source is `studios/cad/forge/` (Python, excluded from tsc/biome).
- PCB authoring fixtures under `studios/pcb/authoring/` are excluded from tsc/biome; need `tsci` for real PCB work. Media needs `ffmpeg`/`ffprobe`.
- Exports: `.` plugin, `./media-provider`, `./media-go`. Build entrypoints in `scripts/build.ts`; do not commit `dist/`.

## Verify before done

Prefer `bun run check` for code changes. Touching forge Python → also `bun run test:python`. Release-shaped changes → `bun run release:check`.

## Docs

- `PLAN.md` — accepted product decisions (no multi-package / no legacy OSC contract)
- `docs/architecture.md` — surfaces and URL namespaces
- `docs/new-studio.md` — add-a-studio checklist
