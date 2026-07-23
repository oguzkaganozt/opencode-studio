# OSC Phase 0 Behavior Matrix

Recorded against the sibling Studio repositories as of OSC Phase 0.
Evidence paths are relative to each Studio repo root unless noted.

Studios:

| Studio | Path | Package version |
| --- | --- | --- |
| CAD | `../opencode-cad-studio` | `0.1.0` |
| Media | `../opencode-media-studio` | `1.3.0` |
| PCB | `../opencode-pcb-studio` | `0.1.0` |

## 1. Package identity

| Item | CAD | Media | PCB |
| --- | --- | --- | --- |
| Package name | `opencode-cad-studio` | `opencode-media-studio` | `opencode-pcb-studio` |
| CLI bin | `opencode-cad-studio` → `dist/cli.js` | `opencode-media-studio` → `dist/cli.js` | `opencode-pcb-studio` → `dist/cli.js` |
| Plugin export | `.` → `dist/plugin.js` | `./server` → `dist/plugin.js` | `./server` → `dist/plugin.js` |
| API export | `./api` → `dist/server.js` | `./api` → `dist/server.js` | `./api` → `dist/server.js` |
| Extra exports | — | `.` → `dist/provider.js` | — |
| `opencode-studio.json` | absent | absent | absent |
| Min OpenCode | `>=1.18.2` (`engines`) | `>=1.18.2` | `>=1.18.2` |
| Runtime | Bun `>=1.3.0` | Bun `>=1.3.0` | Bun `>=1.3.0` |

Evidence: each Studio `package.json`.

Naming already matches OSC intent (`opencode-<domain>-studio`, CLI same name). Plugin export locations differ: CAD uses the bare package root; Media and PCB use `./server`.

## 2. Lifecycle and CLI

| Command / option | CAD | Media | PCB |
| --- | --- | --- | --- |
| `serve` | yes | yes | yes |
| `install` / OpenCode sync | no (`setup` installs skill only) | yes (systemd release deploy) | no |
| `remove` / uninstall | `uninstall` (skill only) | no | no |
| `doctor` | no | no | no |
| `update` | no | yes (release/service) | no |
| `--scope user\|project` | no | `--user` for systemd only | no |
| `--dry-run` | on `setup`/`uninstall` | on `install`/`update` | no |
| `--json` | no | no | no |
| `--help` | not implemented as OSC expects | not implemented as OSC expects | not implemented as OSC expects |
| OpenCode config editing | none (manual README) | none (manual README) | none (manual README) |
| Serve root flag | `--studio-root` | `--directory` | `--workspace` |
| Default bind | `127.0.0.1:4173` | `127.0.0.1:4173` | `127.0.0.1:4174` |

Evidence:

- CAD: `src/cli.ts`, `src/skill.ts`, `README.md`
- Media: `src/cli.ts`, `src/deployment.ts`, `README.md`
- PCB: `src/cli.ts`, `README.md`

### Common behavior

- All expose a Companion via `serve` with loopback default and `SIGINT`/`SIGTERM` shutdown.
- None programmatically edit `opencode.json` / OpenCode config.
- None implement OSC `doctor`.

### Intentional domain differences

- Media's `install`/`update` deploy an always-on systemd unit under `/opt/...` or user share. OSC treats this as an optional extension, not core lifecycle.
- CAD `setup`/`uninstall` manage only the packaged skill file.
- PCB has no lifecycle commands beyond `serve`.

## 3. Skill ownership

| Item | CAD | Media | PCB |
| --- | --- | --- | --- |
| Packaged skill | `skills/cad-studio/SKILL.md` | none | `skills/pcb-studio/SKILL.md` |
| Skill name | `cad-studio` | — | `pcb-studio` |
| Install path | `$XDG_CONFIG_HOME/opencode/skills/cad-studio/` via `setup` | — | consumer points `skills.paths` at packaged `skills/` |
| Ownership marker | none | n/a | none |
| Conflict / digest rules | overwrite on `setup` | n/a | n/a (no sync CLI) |

Evidence: CAD `src/skill.ts`, `skills/cad-studio/SKILL.md`; PCB `skills/pcb-studio/SKILL.md`; Media has no `skills/` tree.

## 4. Companion host

| Item | CAD | Media | PCB |
| --- | --- | --- | --- |
| Framework | Hono + `Bun.serve` | Hono + `Bun.serve` | Hono + `Bun.serve` |
| `GET /api/health` | `{ status: "ok" }` | `{ status: "ok" }` | `{ status: "ok" }` |
| Identity endpoint | `GET /api/version` → `{ version }` | `GET /api/version` (running/installed/npm) | none (`/` may return JSON name when UI absent) |
| `GET /api/studio` | absent | absent | absent |
| Same-origin UI+API | yes when `uiDirectory` set | yes | yes |
| SPA fallback | yes | yes | yes |
| Unknown `/api/*` | JSON 404 path | JSON 404 | JSON / status responses |
| Data Root flag | `--studio-root` | `--directory` | `--workspace` |
| Creates Data Root on start | no (`realpath` requires existing root) | **yes** (`initializeLibrary`) | no (canonical existing workspace) |
| Companion mutates Data Root | no (GET only) | **yes** (upload/rename/delete/move/copy) | no HTTP mutations; **filesystem watcher rebuilds** |
| Observation push | no | no | SSE `/api/events` |

Evidence: CAD `src/server.ts`, `src/library.ts`; Media `src/server.ts`, `src/cli.ts`; PCB `src/server.ts`, `src/watcher.ts`, `src/cli.ts`.

### Common behavior

- Health endpoint shape already matches OSC.
- UI and API share one origin when the built viewer is mounted.
- Domain APIs are Studio-owned and diverge freely.

### Intentional domain differences

- Media Companion is a mutable library service (browser file management).
- PCB Companion watches sources and rebuilds via `tsci` (companion-owned build orchestration).
- CAD Companion is read-only inspection over designs/artifacts.

## 5. Security

| Control | CAD | Media | PCB |
| --- | --- | --- | --- |
| Default loopback | yes | yes (docs also describe `0.0.0.0` + tunnel) | yes |
| Path confinement | strong (`studio-path.ts`, double `realpath`/`isInside`) | strong + identity re-checks | `isInside` on resolved paths; root `realpath` only |
| Symlink / no-follow | rejects escaped/symlinked artifacts; tests cover escape | `O_NOFOLLOW`, `lstat`, component walks | no per-file `realpath`/`lstat` on workspace serve |
| `X-Content-Type-Options: nosniff` | absent | on media/download responses | on workspace file responses only |
| CSP | absent | absent | absent |
| Host / DNS-rebinding guard | absent | absent (Origin check on mutations only) | absent |
| Credential redaction | n/a / none | none explicit | none explicit |
| Telemetry default | none present | none present | none present |

Evidence: CAD `src/studio-path.ts`, `src/server.ts`, `test/server.test.ts`; Media `src/studio-path.ts`, `src/server.ts`, `docs/OPS.md`; PCB `src/studio-path.ts`, `src/server.ts`.

## 6. Viewer stack and design language

| Item | CAD | Media | PCB |
| --- | --- | --- | --- |
| React 19 | no (vanilla JS) | yes `19.2.7` | yes `19.2.7` |
| TypeScript UI | no | yes | yes |
| Vite | yes | yes `8.1.5` | yes `8.1.5` |
| React Router | no | `react-router` `8.2.0` | `react-router` `8.2.0` |
| TanStack Query | no | `5.101.2` | `5.101.2` |
| Tailwind CSS 4 | no (inline CSS) | `4.3.3` | `4.3.3` |
| OSC tokens file | no | Studio-local CSS vars | Tailwind utilities only |
| Fonts | system monospace | DM Mono / IBM Plex Mono (system) | system / Tailwind defaults |
| Layout | canvas + sidebar | library grid + detail routes | header + project tabs |
| Deep links | limited | `/assets/:ref` | `/projects/:id`, `/catalog` |
| Domain renderer | Three.js | media players / grids | `@tscircuit/*` viewers (lazy tabs) |

Evidence: CAD `ui/`, `vite.config.ts`; Media `ui/src/`, `package.json`, `ui/src/styles.css`; PCB `ui/src/`, `package.json`.

Media and PCB already approximate the required stack. CAD needs a viewer rewrite. Shared OSC tokens and Barlow / IBM Plex Mono packaging are absent everywhere.

## 7. Engines, tools, and trust effects

| Item | CAD | Media | PCB |
| --- | --- | --- | --- |
| Tool prefix | `design_*` (+ MCP `build123d_*`) | `media_*`, `fal_*`, `chatgpt_*` | `pcb_*` |
| External binaries | `uv`, Forge Python (`forge/`), build123d MCP | `ffmpeg` / `ffprobe` | `tsci` / `npx`, `npm` |
| Remote providers | none in Companion | fal.ai, ChatGPT image paths | none core |
| Permission asks | `context.ask` edit patterns on mutations | OpenCode ask for edit/read/external | relies on OpenCode tool permissions |
| Process controls | timeout, process-group kill, output caps | spawn argv arrays, size caps | spawn for build/scaffold |
| Output publication | atomic `.artifacts/<gen>` + `current` | staging + identity checks | build outputs under project dirs |

Evidence: CAD `src/plugin.ts`, `src/forge.ts`, `opencode.json`; Media `src/plugin.ts`; PCB `src/plugin.ts`, `src/tsci.ts`, `src/watcher.ts`.

## 8. Common behavior vs intentional differences

### Common today

- Bun + Hono Companion, loopback default, `/api/health`.
- Package naming and CLI binary naming.
- Manual OpenCode plugin registration documented in README.
- No `opencode-studio.json`, no `doctor`, no `/api/studio`, no CSP/Host baseline.
- No shared runtime between Studios.

### Intentional domain differences (preserve)

| Difference | Owner | OSC stance |
| --- | --- | --- |
| Forge / build123d / design artifact layout | CAD | domain-owned |
| fal / ffmpeg / mutable media library | Media | domain-owned; Companion mutations must leave core OSC |
| systemd always-on deploy | Media | optional extension, not core `install`/`remove` |
| tscircuit / Gerber / BOM / watcher rebuild | PCB | domain-owned; rebuild orchestration must leave Companion for OSC read-only host |
| Tool prefixes and engines | each Studio | domain-owned with documented trust effects |
| Default ports | each Studio | Studio-owned |

## 9. Gaps against OSC targets

| OSC target | CAD | Media | PCB |
| --- | --- | --- | --- |
| `opencode-studio.json` | gap | gap | gap |
| CLI `install`/`remove`/`doctor`/`serve` | partial (`setup`/`uninstall`/`serve`) | partial (`install`/`update`/`serve`; wrong semantics) | partial (`serve` only) |
| Safe OpenCode config editing | gap | gap | gap |
| Skill + `.osc-managed.json` | skill without marker | no skill | skill without marker / sync |
| `GET /api/studio` | gap | gap | gap |
| `serve --root` naming | `--studio-root` | `--directory` | `--workspace` |
| Companion Data Root read-only | aligned | **major gap** (HTTP mutations + create-on-start) | **gap** (watcher rebuilds mutate outputs) |
| CSP + Host + consistent nosniff | gap | partial nosniff; CSP/Host gap | partial nosniff; CSP/Host/symlink gap |
| Viewer stack + OSC tokens | **major gap** | stack ok; tokens/fonts gap | stack ok; tokens/fonts gap |
| Read-only Viewer boundary | aligned | **major gap** (browser file management) | mostly aligned (inspection tabs) |
| Conformance entry `bun run test:conformance` | absent | absent | absent |

## 10. Implications for provisional SPEC

1. Manifest must support bare and subpath plugin specifiers (CAD `.` vs Media/PCB `./server`).
2. Core lifecycle must be OpenCode integration only; Media systemd stays optional and separately named.
3. Companion MUST treat Data Root as read-only; Media mutation and PCB watcher rebuilds are migration work, not OSC core.
4. Security baseline must require CSP, Host protection, and nosniff even where path confinement is already strong.
5. Viewer stack requirement matches Media/PCB majority; CAD migration is Studio work.
6. `/api/health` can stay; `/api/studio` is additive and distinct from existing `/api/version` shapes.
