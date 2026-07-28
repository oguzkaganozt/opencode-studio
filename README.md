# OpenCode Studio

OpenCode Studios for CAD and PCB, plus always-on workspace media tools and a Files explorer.

**Package:** [`@oguzkaganozt/opencode-studio`](https://www.npmjs.com/package/@oguzkaganozt/opencode-studio) · **CLI:** `opencode-studio`

**CAD and PCB are always on.** Global install runs `repair` once (plugins, skills, CAD MCP into OpenCode home). Media tools and the Files explorer are always on too.

## Prerequisites

1. Install **[OpenCode](https://opencode.ai)** and authenticate your model providers.
2. Install OpenCode Studio (below).
3. **Restart OpenCode** after install/repair so plugins and skills load.

## Install

```bash
bun add -g @oguzkaganozt/opencode-studio
```

Requires **Bun ≥ 1.3** (install channel + CLI runtime) and a working OpenCode install.
Published on the npm registry; install and upgrade only via bun.

Domain engines ship in the package:

| Engine | Source |
| --- | --- |
| `ffmpeg` / `ffprobe` | `ffmpeg-static` / `ffprobe-static` |
| `tsci` | bundled `tscircuit` CLI |
| `uv` | downloaded once into XDG cache on first CAD/status use |

## Quick start

```bash
# after bun add -g + restart OpenCode
cd /path/to/your/project
opencode serve
```

OpenCode loads the studio plugin for that directory. The plugin starts the Studio host in-process and attaches to this serve.

Then open **[http://127.0.0.1:4173/studio](http://127.0.0.1:4173/studio)** — OpenCode home, CAD / PCB / Files. Parent OpenCode UI is proxied at `/` (full-pane home + Agent side panel on domain pages).

| URL | What |
| --- | --- |
| `http://127.0.0.1:4173/studio` | Studio shell (OpenCode home iframe) |
| `http://127.0.0.1:4173/studio/studios/cad` | CAD viewer |
| `http://127.0.0.1:4173/` | Proxied native OpenCode (iframe source) |

Health: `opencode-studio status`. If install skipped setup: `opencode-studio repair`, then restart OpenCode.

Studio does **not** spawn OpenCode and has no separate `serve` / systemd host daemon. Lifecycle follows `opencode serve`. Opt out of auto host: `OPENCODE_STUDIO_AUTOSTART=0`.

### Web / LAN (same model as `opencode serve`)

When OpenCode listens on all interfaces, Studio follows (or set env explicitly):

```bash
# opencode-setup style
export OPENCODE_SERVER_PASSWORD='strong-password'
opencode serve --hostname 0.0.0.0 --port 4096
# Studio binds 0.0.0.0:4173 and uses the same Basic password
# → http://<server-ip>:4173/studio
```

| Env | Role |
| --- | --- |
| `OPENCODE_STUDIO_HOSTNAME` / `OPENCODE_STUDIO_BIND=0.0.0.0\|web` | Force Studio bind (default: inherit parent `0.0.0.0`, else loopback) |
| `OPENCODE_STUDIO_PORT` | Studio port (default `4173`; multi-user: one port per Linux user) |
| `OPENCODE_SERVER_PASSWORD` or `OPENCODE_STUDIO_PASSWORD` | Required for non-loopback — Basic on **all** Studio routes except `/studio-api/health` |
| `OPENCODE_SERVER_USERNAME` / `OPENCODE_STUDIO_USERNAME` | Basic user (default `opencode` if only server password is set) |

Multi-user ops: each **OpenCode** `serve` unit gets its own `OPENCODE_STUDIO_PORT` (e.g. 4173 / 4174 / 4175). Studio has no separate host systemd unit.

Install is **user-global** — postinstall repairs once; run `repair` only if needed. Domain data roots default to the OpenCode directory.

### Config (global)

| File | Purpose |
| --- | --- |
| `~/.config/opencode-studio/studio.json` | Optional absolute `roots` only (domains always on) |
| `~/.config/opencode/opencode.json` | Unversioned plugin registrations + managed `build123d` MCP |
| `~/.config/opencode/skills/studio-<id>/` | Managed skills (`studio-cad`, `studio-pcb`, `studio-media`) |

```json
{ "roots": { "cad": "/absolute/path" } }
```

Missing `studio.json` is fine. Media paths are workspace-scoped.

**Upgrade from project-local config:** if global config is missing and the domain still has `.opencode/studio.json` with roots, roots are migrated on plugin load. Run `opencode-studio repair` once to finish (registers global plugins/skills and scrubs leftover project files).

### CLI

```bash
opencode-studio status [--workspace <path>]     # health + version (exit 1 if broken)
opencode-studio repair [--workspace <path>]     # reinstall plugins/skills/MCP
opencode-studio remove                          # uninstall managed OpenCode state
opencode-studio upgrade [--check]               # bun add -g @latest
opencode-studio --help | -v
```

Shell completion is installed automatically on global `bun add -g` (scripts under `~/.config/opencode-studio/`). Skip: `OPENCODE_STUDIO_SKIP_POSTINSTALL=1`.

Open a new shell after install (or `source ~/.bashrc`).

## Package exports

| Export | Role |
| --- | --- |
| `@oguzkaganozt/opencode-studio` | Primary OpenCode plugin |
| `@oguzkaganozt/opencode-studio/media-provider` | Native media AI SDK adapter |
| `@oguzkaganozt/opencode-studio/media-go` | Auxiliary plugin for `opencode-go` provider hooks |

Global install and `opencode-studio repair` register OpenCode plugins without version pins and manage skills under `~/.config/opencode/skills/` (plus managed `build123d` MCP).

## Develop (this repo)

```bash
bun install
bun run check                 # typecheck + test + lint + build
bun run release:check         # full gate (incl. forge, pack, browser smoke)
bun run build && opencode serve   # plugin ensure-hosts Viewer @ :4173
bun run dev:ui                # Vite :5173 → proxies /api
bun run test:browser:install  # once: Playwright Chromium
```

```text
src/                 CLI, plugin, host, config, core
studios/             cad | pcb
src/platform/media/  always-on media tools + Files API
ui/                  Viewer shell + lazy studio pages
test/                core + parity
scripts/             build, smokes, create-studio
```

## Docs

- [AGENTS.md](AGENTS.md) — agent/contributor guardrails

## License

MIT
