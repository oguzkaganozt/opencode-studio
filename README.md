# OpenCode Studio

One configurable OpenCode package for CAD, media, PCB, and startup workflows.

## Develop

```bash
bun install
bun test
bun run typecheck
bun run lint
bun run build
bun src/cli.ts serve --workspace .
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

- `opencode-studio` — primary OpenCode plugin
- `opencode-studio/media-provider` — native media AI SDK adapter
- `opencode-studio/media-go` — auxiliary plugin for `opencode-go` provider hooks

## Docs

- [PLAN.md](PLAN.md) — accepted decisions and definition of done
- [docs/architecture.md](docs/architecture.md)
- [docs/new-studio.md](docs/new-studio.md)
