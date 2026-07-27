# Architecture

OpenCode Studio is a modular monolith: one package, one plugin, one host, one Viewer.

## Surfaces

| Surface | Owner | Notes |
| --- | --- | --- |
| CLI / config / lifecycle | `src/` | `configure`, `status`, `doctor`, `serve`, `remove` |
| OpenCode plugin | `src/plugin.ts` | Always composes platform media, then enabled domain studios |
| Host HTTP | `src/server.ts` | Host checks, CSRF on writes, static UI, native OpenCode proxy, Files API |
| OpenCode bridge | `src/opencode-bridge.ts` | Lazy loopback sidecar or attach mode; owned-sidecar native proxy + workspace pin |
| Platform media | `src/platform/media/` | Always-on tools, provider hooks, Files API, `media` skill |
| Studio modules | `studios/*` | Domain CAD/PCB tools, API routers, skills, viewers |
| Viewer shell | `ui/` | Home + Files + per-Studio pages; Agent panel embeds native OpenCode UI |

## Configuration

**Config global, data local.**

| Concern | Location |
| --- | --- |
| Domain enablement + optional absolute `roots` | `~/.config/opencode-studio/studio.json` |
| Unversioned plugin registrations + managed MCP | `~/.config/opencode/opencode.json` |
| Domain skills | `~/.config/opencode/skills/<id>-studio/` |
| Platform media skill | `~/.config/opencode/skills/media/` |
| CAD/PCB domain data | `serve --workspace` / OpenCode project directory (or `roots.*`) |
| Media files | Same workspace (default dir `media/`) |

```json
{ "enabled": ["cad", "pcb"] }
```

Fail-closed for **domain** studios: missing or invalid config enables no CAD/PCB. Platform media tools + Files explorer remain available.

`remove` / `enabled: []` disables domain studios only. Unversioned main plugin/media-go registrations and the `media` skill stay installed (remove ≠ full uninstall).

## Composition order

1. Platform media (tools + provider hooks) — always
2. Enabled catalog studios in order: `cad`, `pcb`

## Namespaces

- OpenCode web UI/API: `/`, `/session/*`, `/server/*`, `/api/*`, and other native routes proxied to the owned sidecar
- Viewer shell: `/studio`
- Files explorer: `/studio/files`, API `/api/files/*`
- Viewer: `/studio/studios/<id>/*`
- PCB project tabs: `/studio/studios/pcb/projects/<id>/{schematic|pcb|bom|3d|json}`
- Studio Agent panel: same-origin iframe of native OpenCode (`/`, handoff via `/<base64url-workspace>/session?prompt=`)
- Domain API: `/api/studios/<id>/*`
- Host config API: `/api/studios`, `/api/config`, `/studio-api/health`, `/api/csrf`

## Security notes

- Loopback (`serve --local`): Files API is readable without password (single-user posture).
- Non-loopback (`serve --web`): `/api/files/*` requires HTTP Basic (`opencode-studio` + `OPENCODE_STUDIO_PASSWORD`), same as OpenCode proxy.
- Files tree hides dotfiles (including `.env`). Paths are workspace-jailed; symlinks rejected.
- Full-file `/api/files/raw` streams; range slices are capped.

## Domain / platform exceptions

- CAD manages a pinned `build123d` MCP entry while enabled.
- Platform media exports `opencode-studio/media-provider` (AI SDK adapter) and `opencode-studio/media-go` (opencode-go provider hook).
