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

Requires **Bun ≥ 1.3** (CLI runtime). Optional engines:

| Studio | Needs |
| --- | --- |
| CAD | Python 3.12 + [uv](https://docs.astral.sh/uv/) |
| Media | `ffmpeg` / `ffprobe` |
| PCB | `tsci` (for real authoring builds) |

## Quick start

In any project directory:

```bash
cd /path/to/project
opencode-studio serve
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) → tick the Studios you want → **Apply selection**.

Then restart **OpenCode** and `opencode-studio serve` so plugin, skills, and APIs reload.

`serve` defaults to the current working directory (`--workspace` only if you need another path).

### Config

Written by the home UI (or CLI). Project file: `.opencode/studio.json`

```json
{ "enabled": ["cad", "pcb"] }
```

Optional absolute `roots.<id>` overrides. Media defaults to XDG user-data (`~/.local/share/opencode-studio/media`), not the workspace.

### CLI (optional)

```bash
opencode-studio serve [--workspace <path>] [--host <host>] [--port <port>]
opencode-studio status|doctor|remove [--workspace <path>]
opencode-studio configure <studios...> [--workspace <path>]   # same as home UI Apply
```

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

- [PLAN.md](PLAN.md) — product decisions
- [docs/architecture.md](docs/architecture.md)
- [docs/new-studio.md](docs/new-studio.md)
- [AGENTS.md](AGENTS.md) — agent/contributor guardrails

## License

MIT
