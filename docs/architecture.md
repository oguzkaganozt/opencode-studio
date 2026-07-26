# Architecture

OpenCode Studio is a modular monolith: one package, one plugin, one host, one Viewer.

## Surfaces

| Surface | Owner | Notes |
| --- | --- | --- |
| CLI / config / lifecycle | `src/` | `configure`, `status`, `doctor`, `serve`, `remove` |
| OpenCode plugin | `src/plugin.ts` | Composes only enabled Studios |
| Host HTTP | `src/server.ts` | Host checks, CSRF on writes, agent API, static UI |
| OpenCode bridge | `src/opencode-bridge.ts` | Lazy loopback sidecar or configured server, workspace-pinned sessions |
| Studio modules | `studios/*` | Domain tools, API routers, skills, viewers |
| Viewer shell | `ui/` | Home page + per-Studio pages |

## Configuration

**Config global, data local.**

| Concern | Location |
| --- | --- |
| Enablement + optional absolute `roots` | `~/.config/opencode-studio/studio.json` |
| Plugin pin + managed MCP | `~/.config/opencode/opencode.json` |
| Managed skills | `~/.config/opencode/skills/<id>-studio/` |
| CAD/PCB/startup domain data | `serve --workspace` / OpenCode project directory (or `roots.*`) |
| Media library | XDG user-data (`~/.local/share/opencode-studio/media`) |

```json
{ "enabled": ["cad", "pcb"] }
```

Fail-closed: missing or invalid config enables nothing.

## Namespaces

- OpenCode web UI/API: `/`, `/session/*`, `/api/*`, and other native routes proxied to the sidecar
- Viewer shell: `/studio`
- Viewer: `/studio/studios/<id>/*`
- API: `/api/studios/<id>/*`
- Host config API: `/api/studios`, `/api/config`, `/studio-api/health`, `/api/csrf`

## Domain exceptions

- CAD manages a pinned `build123d` MCP entry while enabled.
- Media exports `opencode-studio/media-provider` (AI SDK adapter) and `opencode-studio/media-go` (opencode-go provider hook).
