# Lock — Shell + Files + CAD + PCB

**Status:** Files + CAD + PCB + **Shell LOCKED** 2026-07-28  
**Do not restyle** without explicit unlock.

### Shell lock addendum (this pass)
| Surface | Paths |
| --- | --- |
| Tokens / global | `ui/tokens.css`, `ui/styles.css` |
| Primitives | `ui/components/*` |
| Shell | `ui/app.tsx` (TopBar, SideDrawer, Home, Agent actions, frames) |
| Agent chrome | `ui/native-agent-frame.tsx` |
| Spec | `MASTER.md`, `pages/shell.md` |

### CAD lock addendum
| Surface | Paths |
| --- | --- |
| CAD viewer | `studios/cad/viewer/src/app.tsx`, `styles.css` |
| Spec | `pages/cad.md` |

QA: empty workspace desktop/mobile; chips; rail; inspector; compact agent mode. No designs in workspace — geometry/click path not exercised live.

### PCB lock addendum
| Surface | Paths |
| --- | --- |
| PCB viewer | `studios/pcb/viewer/src/*` (app, styles, tabs, svg-viewer) |
| Spec | `pages/pcb.md` |

QA: projects list/mobile; project detail tabs; catalog empty; empty/error states. Fixture project unbuilt — schematic/PCB/BOM content paths not live-rendered.

## Locked surfaces

| Surface | Paths |
| --- | --- |
| Tokens / global | `ui/tokens.css`, `ui/styles.css` |
| Primitives | `ui/components/*` |
| Shell | `ui/app.tsx` (TopBar, SideDrawer, Home, Agent chrome, frames) |
| Agent chrome | `ui/native-agent-frame.tsx` (header chips) |
| Files | `ui/files-explorer.tsx` |
| Spec | `MASTER.md`, `pages/shell.md`, `pages/files.md`, `pages/cad.md`, `pages/pcb.md` |

## Visual QA (agent-browser) — shell polish 2026-07-28

Auth: HTTP Basic via `--headers` JSON (not `user:pass@url`). Studio UI path: `/studio/`. Live host may serve from OpenCode package cache — sync `dist/ui` for dogfood.

| Check | Result |
| --- | --- |
| Home 1440 light/dark | Pass — cards, elevation, chips, badges |
| Drawer Navigate + Settings | Pass — Appearance first; Studios on-badges; Install + details; sticky Repair |
| Home mobile 390 | Pass — compact type, OC chip, touch targets |
| Drawer mobile full-bleed | Pass — Navigate selected, safe close |
| CAD shell desktop/mobile | Pass — TopBar + Agent dual-line header (viewer interior locked) |
| Console errors (happy path) | None observed |
| typecheck / lint / unit tests | Pass |

### Fixed this pass

- Clearer light/dark elevated vs page separation (tokens)
- Settings radial icon; Navigate \| Settings segments
- Settings order: Appearance → Studios → Install (paths + details) → Repair helper
- Home ErrorState + Retry; EmptyState when zero studios
- Studio host load skeleton / ErrorState
- Mobile: larger icon hit targets, nav row min-height, OC chip collapse, safe-area on TopBar/footer
- Agent header dual-line status + loading pulse overlay

### Residual (accepted)

- Agent-browser a11y snapshot may still list off-screen drawer nodes; runtime `inert`/`aria-hidden` set correctly
- URL-embedded Basic auth breaks relative `fetch` — use Authorization header
- CAD/PCB viewer interiors unchanged (locked)
- Agent open state persists across routes (prior behavior)
- Dual-line agent header is snug in 48px chrome height

## Screenshots

`/tmp/opencode/dogfood-shell/screenshots/`
