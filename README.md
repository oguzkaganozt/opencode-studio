# OpenCode Studio

OpenCode Studios for CAD and PCB, plus always-on workspace media tools and a Files explorer.

**Package:** [`@oguzkaganozt/opencode-studio@1.0.5`](https://www.npmjs.com/package/@oguzkaganozt/opencode-studio) · **CLI:** `opencode-studio`

**CAD and PCB are always on.** Install wires OpenCode once (plugins, skills, CAD MCP). Media tools and the Files explorer are always on too.

## Prerequisites

1. **[OpenCode](https://opencode.ai)** ≥ 1.18.2 — authenticate your model providers.
2. **Bun ≥ 1.3** on PATH (install channel + CLI runtime).
3. **Node + npm** recommended for PCB project scripts (if missing, build falls back to bundled `tsci`).
4. Restart OpenCode after install/repair so plugins and skills load.

## Install (pinned)

```bash
bun add -g @oguzkaganozt/opencode-studio@1.0.5
hash -r
command -v opencode-studio

# Greenfield: postinstall is soft — always repair
opencode-studio repair
opencode-studio status --workspace /path/to/your/project
# exit 0; plugin + media-go + MCP@0.3.80 + skills must pass
```

From a git checkout (before/without registry publish):

```bash
bun install && bun run build
bun link   # or: bun add -g "$(pwd)"
opencode-studio repair
```

Domain engines ship in the package:

| Engine | Source |
| --- | --- |
| `ffmpeg` / `ffprobe` | `ffmpeg-static` / `ffprobe-static` (arm64: system **ffprobe** on PATH) |
| `tsci` | bundled `tscircuit` CLI |
| `uv` | downloaded once into XDG cache on first CAD/status use |

## Quick start

```bash
# after repair + OpenCode restart
opencode serve
# Studio starts immediately with $HOME as its fixed Studio Home
```

The serve wrapper starts the Studio host and attaches it to this OpenCode server.

Then open **[http://127.0.0.1:4173/studio](http://127.0.0.1:4173/studio)** — OpenCode home, CAD / PCB / Files. Parent OpenCode UI is proxied at `/` (full-pane home + Agent side panel on domain pages).

| URL | What |
| --- | --- |
| `http://127.0.0.1:4173/studio` | Studio shell (OpenCode home iframe) |
| `http://127.0.0.1:4173/studio/studios/cad` | CAD viewer |
| `http://127.0.0.1:4173/` | Proxied native OpenCode (iframe source) |

**Critical:** `repair` installs `~/.local/bin/opencode` wrapper so **`opencode serve` auto-starts Studio** (`ensure-host`, fixed Studio Home `$HOME`). Keep `~/.local/bin` early on `PATH`. OpenCode projects affect only their own Agent requests; they never change Studio Home. Opt out: `OPENCODE_STUDIO_AUTOSTART=0`.

Health: `opencode-studio status` (exit 1 if unwired). CAD: `design_build` runs forge `uv sync` outside the 120s build timer (no separate warm step). Prefer **`OPENCODE_SERVER_PASSWORD`** on the OpenCode process (Studio-only password breaks Agent proxy).

Studio does **not** spawn OpenCode and has no separate `serve` / systemd host daemon. Lifecycle follows `opencode serve`. Opt out of auto host: `OPENCODE_STUDIO_AUTOSTART=0`.

**Team / internal server:** systemd, pin/rollback, full checklist → [`v1-release-plan.md`](./v1-release-plan.md).

### Web / LAN (same model as `opencode serve`)

```bash
export OPENCODE_SERVER_PASSWORD='strong-password'
opencode serve --hostname 0.0.0.0 --port 4096
# Studio binds 0.0.0.0:4173 and uses the same Basic password
# → http://<server-ip>:4173/studio
```

| Env | Role |
| --- | --- |
| `OPENCODE_STUDIO_HOSTNAME` / `OPENCODE_STUDIO_BIND=0.0.0.0\|web` | Force Studio bind (default: inherit parent `0.0.0.0`, else loopback) |
| `OPENCODE_STUDIO_PORT` | Studio port (default `4173`; multi-user: one port per Linux user) |
| `OPENCODE_STUDIO_WORKSPACE` | Explicit fixed Studio Home override (default `$HOME`; restart serve to change) |
| `OPENCODE_SERVER_PASSWORD` or `OPENCODE_STUDIO_PASSWORD` | Required for non-loopback — Basic on **all** Studio routes except `/studio-api/health` |
| `OPENCODE_SERVER_USERNAME` / `OPENCODE_STUDIO_USERNAME` | Basic user (default `opencode` if only server password is set) |
| `OPENCODE_STUDIO_ALLOWED_ORIGINS` | Extra origins when browser Origin ≠ Host (reverse-proxy) |

Prefer SSH tunnel to loopback. If public: TLS at your reverse-proxy; enable WebSocket upgrade; app stays HTTP.

### Config (global)

| File | Purpose |
| --- | --- |
| `~/.config/opencode-studio/studio.json` | Optional absolute `roots` only (domains always on) |
| `~/.config/opencode/opencode.json` | Unversioned plugin registrations + managed `build123d` MCP |
| `~/.config/opencode/skills/studio-<id>/` | Managed skills (`studio-cad`, `studio-pcb`, `studio-media`) |

```json
{ "roots": { "cad": "/absolute/path" } }
```

Missing `studio.json` is fine. CAD/PCB roots default to fixed Studio Home; configured roots are persistent overrides. Media paths remain OpenCode-project-scoped. Keep **one** of `opencode.json` / `opencode.jsonc`.

**Upgrade from project-local config:** if global config is missing and the domain still has `.opencode/studio.json` with roots, roots are migrated on plugin load. Run `opencode-studio repair` once to finish.

### CLI

```bash
opencode-studio status [--workspace <path>]     # health + version (exit 1 if broken)
opencode-studio repair [--workspace <path>]     # reinstall plugins/skills/MCP
opencode-studio remove                          # uninstall managed OpenCode state
opencode-studio upgrade [--check]               # bun add -g @latest (prefer pin for servers)
opencode-studio --help | -v
```

Shell completion installs on global `bun add -g`. Skip: `OPENCODE_STUDIO_SKIP_POSTINSTALL=1`.

### Upgrade / rollback (servers)

```bash
# Prefer an explicit pin over unattended @latest
bun add -g @oguzkaganozt/opencode-studio@1.0.5
opencode-studio repair
opencode-studio status --workspace /abs/project
# restart OpenCode

# Rollback
opencode-studio remove
bun add -g @oguzkaganozt/opencode-studio@<previous>
opencode-studio repair
```

## Package exports

| Export | Role |
| --- | --- |
| `@oguzkaganozt/opencode-studio` | Primary OpenCode plugin |
| `@oguzkaganozt/opencode-studio/media-provider` | Native media AI SDK adapter |
| `@oguzkaganozt/opencode-studio/media-go` | Auxiliary plugin for `opencode-go` provider hooks |

`repair` registers the main plugin unversioned and media-go as `file://…/dist/media-go.js` (loadable from the package tree).

## Develop (this repo)

```bash
bun install
bun run check          # typecheck + test + lint + build
bun run dev:ui         # Vite :5173
```

See `AGENTS.md` for layout, security hard rules, and contribution gates.
