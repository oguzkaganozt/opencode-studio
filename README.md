# OpenCode Studio

One configurable OpenCode package for CAD, media, PCB, and startup workflows.

## Develop

```bash
bun install
bun test
bun run typecheck
bun run lint
bun run build
bun run serve
```

Prerequisites: Bun ≥ 1.3. For `release:check` and CAD forge tests: Python 3.12 + [uv](https://docs.astral.sh/uv/). UI browser smoke needs Playwright Chromium once (`bun run test:browser:install`). Media needs `ffmpeg`/`ffprobe`. PCB authoring needs `tsci`.

## Install

```bash
bun add -g @oguzkaganozt/opencode-studio
# or: npm i -g @oguzkaganozt/opencode-studio
```

## Configure

Installing the package enables **no** Studio.

```bash
opencode-studio configure cad pcb
opencode-studio status
opencode-studio doctor
opencode-studio serve --workspace .
opencode-studio remove
```

Or open the home page at `http://127.0.0.1:4173` after `serve`.

Project config: `.opencode/studio.json`

```json
{ "enabled": ["cad", "pcb"] }
```

After any configure change, restart OpenCode and the Studio host.

## Layout

```text
src/                 shared CLI, plugin, server, config, core
studios/             cad | media | pcb | startup modules
ui/                  shared Viewer shell + lazy studio pages
test/                core + parity tests
scripts/             build, package smoke, create-studio
```

## Package exports

- `@oguzkaganozt/opencode-studio` — primary OpenCode plugin
- `@oguzkaganozt/opencode-studio/media-provider` — native media AI SDK adapter
- `@oguzkaganozt/opencode-studio/media-go` — auxiliary plugin for `opencode-go` provider hooks

## Docs

- [PLAN.md](PLAN.md) — accepted decisions and definition of done
- [docs/architecture.md](docs/architecture.md)
- [docs/new-studio.md](docs/new-studio.md)
