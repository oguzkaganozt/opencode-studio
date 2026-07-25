# OpenCode Studio

Configurable OpenCode Studios for CAD, media, PCB, and startup workflows.

**Package:** [`@oguzkaganozt/opencode-studio`](https://www.npmjs.com/package/@oguzkaganozt/opencode-studio) · **CLI:** `opencode-studio`

Installing the package enables **no** Studio until you configure one.

## Install

```bash
npm i -g @oguzkaganozt/opencode-studio
# or
bun add -g @oguzkaganozt/opencode-studio
```

Requires **Bun ≥ 1.3** (CLI runtime).

Domain engines ship with the npm package (not tied to which Studio you enable):

| Engine | Source |
| --- | --- |
| `ffmpeg` / `ffprobe` | `ffmpeg-static` / `ffprobe-static` |
| `tsci` | bundled `tscircuit` CLI |
| `uv` | downloaded once into XDG cache on first CAD/doctor use |

Enable/disable Studios only toggles tools/skills/APIs — it does not install or remove engines.

## Quick start

```bash
opencode-studio serve
# optional: domain data root for CAD/PCB/startup (default: cwd)
opencode-studio serve --workspace /path/to/project
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) → tick the Studios you want → **Apply selection**.

The host reloads studio APIs on Apply. Restart **OpenCode** so plugins and skills match.

Enablement is **user-global** — you only configure once. `--workspace` is the domain data root (where designs/boards live), not a per-project config file.

### Config (global)

Written by the home UI (or CLI):

| File | Purpose |
| --- | --- |
| `~/.config/opencode-studio/studio.json` | `{ "enabled": ["cad", "pcb"] }` + optional absolute `roots` |
| `~/.config/opencode/opencode.json` | Plugin pin + managed `build123d` MCP |
| `~/.config/opencode/skills/<id>-studio/` | Managed agent skills |

```json
{ "enabled": ["cad", "pcb"] }
```

Missing/invalid config → no studios (fail-closed). Media data defaults to XDG user-data (`~/.local/share/opencode-studio/media`).

**Upgrade from project-local config:** if `~/.config/opencode-studio/studio.json` is missing and the domain still has `.opencode/studio.json`, enablement is migrated automatically on `serve` / plugin load. Run `opencode-studio configure <studios…>` once to finish (pins global plugin/skills and scrubs leftover project `opencode.json` / skills). Or delete old project files after configure.

### Background service (Linux systemd user)

Keep the host running without a terminal:

```bash
cd /path/to/project
opencode-studio service install          # writes ~/.config/systemd/user/opencode-studio.service + enable --now
opencode-studio service status
opencode-studio service stop|start|restart
opencode-studio service uninstall
opencode-studio upgrade                  # npm i -g @latest (+ restart unit if installed)
opencode-studio upgrade --check          # report only (exit 1 if update available)
```

Options: `--workspace` (domain data root), `--host`, `--port`, `--name <unit>` (multiple hosts/ports).  
After logout, if the unit stops: `loginctl enable-linger $USER`.

While `serve` is running, the home page shows a banner when a newer npm version exists (also logged to the service journal).

### CLI (optional)

```bash
opencode-studio serve [--workspace <path>] [--host <host>] [--port <port>]
opencode-studio service install|uninstall|start|stop|restart|status [...]
opencode-studio upgrade [--check]                              # npm i -g @latest; restart unit if present
opencode-studio status|doctor [--workspace <path>]
opencode-studio configure <studios...> [--workspace <path>]   # same as home UI Apply (global)
opencode-studio remove                                         # clear all studios (global)
opencode-studio completion bash|zsh                            # print shell tab-completion script
```

Tab completion:

```bash
# Automatic on: npm i -g @oguzkaganozt/opencode-studio
# (appends eval lines to ~/.bashrc and ~/.zshrc when missing)

# Manual / repair
opencode-studio completion install

# Skip automatic install
OPENCODE_STUDIO_SKIP_COMPLETION=1 npm i -g @oguzkaganozt/opencode-studio
```

Open a new shell after install (or `source ~/.bashrc`).

## Package exports

| Export | Role |
| --- | --- |
| `@oguzkaganozt/opencode-studio` | Primary OpenCode plugin |
| `@oguzkaganozt/opencode-studio/media-provider` | Native media AI SDK adapter |
| `@oguzkaganozt/opencode-studio/media-go` | Auxiliary plugin for `opencode-go` provider hooks |

Apply/configure also pins OpenCode plugins and managed skills under `.opencode/skills/`.

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
studios/             cad | media | pcb | startup
ui/                  Viewer shell + lazy studio pages
test/                core + parity
scripts/             build, smokes, create-studio
```

## Docs

- [docs/architecture.md](docs/architecture.md)
- [docs/new-studio.md](docs/new-studio.md)
- [AGENTS.md](AGENTS.md) — agent/contributor guardrails

## License

MIT
