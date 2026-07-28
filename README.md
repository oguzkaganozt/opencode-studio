# OpenCode Studio

OpenCode Studios for CAD and PCB, plus always-on workspace media tools and a Files explorer.

**Package:** [`@oguzkaganozt/opencode-studio`](https://www.npmjs.com/package/@oguzkaganozt/opencode-studio) · **CLI:** `opencode-studio`

**CAD and PCB are always on.** Global install runs `repair` once (plugins, skills, CAD MCP into OpenCode home). Media tools and the Files explorer are always on too.

## Prerequisites

1. Install **[OpenCode](https://opencode.ai)** and authenticate your model providers (Studio embeds OpenCode for the Agent panel and domain tools).
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
opencode-studio serve
# optional: domain data root for CAD/PCB (default: cwd)
opencode-studio serve --workspace /path/to/project
```

Open **[http://127.0.0.1:4173/studio](http://127.0.0.1:4173/studio)** — CAD and PCB viewers live under `/studio`. Health: `opencode-studio status`. If install skipped setup: `opencode-studio repair`, then restart OpenCode.

Each Studio pairs a domain viewer with an embedded OpenCode agent panel (same-origin iframe of the native OpenCode web UI). The host lazily starts one loopback OpenCode sidecar for the selected `--workspace`, using your existing OpenCode configuration, providers, plugins, and skills. Native OpenCode requests are pinned to that same workspace. The Agent iframe mounts on first open and stays mounted while you switch studios.

Set `OPENCODE_STUDIO_OPENCODE_URL` to attach Studio tools to an existing OpenCode server instead. Native UI proxying and the embedded Agent panel are intentionally disabled in attach mode because a shared server can carry events from other workspaces; use that server's own URL for its native UI.

Same host, two surfaces:

| URL | What |
| --- | --- |
| `http://127.0.0.1:4173/` | Native OpenCode web UI (also embedded in Studio → Agent) |
| `http://127.0.0.1:4173/studio` | OpenCode Studio (CAD / PCB / Files) |

Bind modes:

- `--local` (default) — `127.0.0.1` only
- `--web` — `0.0.0.0` (LAN/internet); requires `OPENCODE_STUDIO_PASSWORD`

```bash
OPENCODE_STUDIO_PASSWORD='choose-a-strong-password' \
  opencode-studio serve --workspace /path/to/project --web
```

Open `http://<server-ip>:4173/studio` and open **Agent** — the browser prompts for HTTP Basic credentials. Defaults: username `opencode-studio`, password = `OPENCODE_STUDIO_PASSWORD`. Override user with `OPENCODE_STUDIO_USERNAME`. `serve --web` prints both. The same credentials unlock `http://<server-ip>:4173/` and `/api/files/*` (Files explorer). Keep the host behind a trusted network or VPN; this password does not add TLS.

Install is **user-global** — postinstall repairs once; run `repair` only if needed. `--workspace` is the domain data root (where designs/boards live), not a per-project config file.

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

**Upgrade from project-local config:** if global config is missing and the domain still has `.opencode/studio.json` with roots, roots are migrated on `serve` / plugin load. Run `opencode-studio repair` once to finish (registers global plugins/skills and scrubs leftover project files).

### Background service (Linux systemd user)

Keep the host running without a terminal:

```bash
cd /path/to/project
opencode-studio service install          # writes ~/.config/systemd/user/opencode-studio.service + enable --now
opencode-studio service status
opencode-studio service stop|start|restart
opencode-studio service uninstall
opencode-studio upgrade                  # bun add -g @latest (+ restart unit if installed)
opencode-studio upgrade --check          # report only (exit 1 if update available)
```

Options: `--workspace` (domain data root), `--local` / `--web`, `--port`, `--name <unit>` (multiple units/ports). For `--web` service install, set `OPENCODE_STUDIO_PASSWORD`; it is copied into the user unit.
After logout, if the unit stops: `loginctl enable-linger $USER`.

While `serve` is running, the home page shows a banner when a newer registry version exists (also logged to the service journal).

### CLI

```bash
opencode-studio serve [--workspace <path>] [--local|--web] [--port <port>]
opencode-studio status [--workspace <path>]     # health + version (exit 1 if broken)
opencode-studio repair [--workspace <path>]     # reinstall plugins/skills/MCP
opencode-studio remove                          # uninstall managed OpenCode state
opencode-studio upgrade [--check]
opencode-studio service install|uninstall|start|stop|restart|status [...]
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
bun run serve                 # host @ 127.0.0.1:4173
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
