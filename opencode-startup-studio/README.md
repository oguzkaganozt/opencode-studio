# opencode-startup-studio

Agentic **idea mining / research / paper-eval** harness for OpenCode.

- **Plugin tools** write the candidate pool under a Data Root
- **Skill** runs a deliberate research → evidence → score → upsert session
- **Companion viewer** is a read-only inspection UI for the pool

Not a product builder. No smoke ads, Stripe, promote gates, or batch mine motor.

## Architecture

| Layer | Role |
|-------|------|
| Skill `startup-studio` | Workflow, filters, rubric, session caps |
| Plugin `startup_*` | Deterministic FS tools on `pool.json` / `rejects.json` |
| Agent + web tools | Search, fetch, judgment |
| Companion + Viewer | Read-only browse/filter/deep-link |

Filesystem is the bus. Companion never mutates the Data Root.

## Setup

```bash
bun install
bun run build
bun link   # optional: global CLI

# OpenCode integration
opencode-startup-studio install
# or from this repo after build: bun src/cli.ts install
```

## Run

Two terminals:

```bash
# Terminal 1 — companion (Data Root must already exist)
bun run serve
# → http://127.0.0.1:4190

# Terminal 2
opencode
```

Dogfood Data Root: `./workspace` (`pool.json`, `rejects.json`).

Dev plugin config is `opencode.json` (loads `./src/plugin.ts` with `dataRoot: ./workspace`).

## Tools

| Tool | Purpose |
|------|---------|
| `startup_list` | List/filter pool |
| `startup_read` | Full candidate |
| `startup_upsert` | Create/replace candidate |
| `startup_reject` | Pool → rejects |
| `startup_check_evidence` | HTTP URL liveness |
| `startup_status` | Counts + top scores |
| `startup_view` | Viewer URL + health |

## CLI (OSC lifecycle)

```text
opencode-startup-studio install [--scope user|project] [--dry-run] [--json]
opencode-startup-studio remove  [--scope user|project] [--dry-run] [--json]
opencode-startup-studio doctor  [--scope user|project] [--json] [--root PATH] [--companion-url URL]
opencode-startup-studio serve --root PATH [--host HOST] [--port PORT]
```

## Scripts

```bash
bun run typecheck
bun test
bun run build
bun run check
```

## OSC

Manifest: `opencode-studio.json` (`id: startup`). Contract-oriented shell copied from OpenCode Studio Contract reference studio; domain is idea-pool specific.

## License

MIT
