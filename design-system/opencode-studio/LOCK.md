# Lock — Shell + Files (batch 1–2)

**Status:** Shell + Files + CAD + PCB LOCKED 2026-07-28  
**Do not restyle** host shell, Files, CAD, or PCB viewers without explicit unlock.

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
| Spec | `MASTER.md`, `pages/shell.md`, `pages/files.md` |

## Visual QA (agent-browser)

Auth: HTTP Basic via `--headers` (not `user:pass@url` — Chromium rejects `fetch` when the document URL embeds credentials).

| Check | Result |
| --- | --- |
| Home 1440 light/dark | Pass — cards, badges, chips |
| Drawer nav + settings | Pass — theme, repair sticky |
| Files list + preview | Pass — icons, crumbs, download, text well |
| Files mobile list/preview | Pass — ← List back |
| Home mobile | Pass — OpenCode chip |
| Console errors (happy path) | None |
| typecheck / lint / unit tests | Pass |

### Fixed from QA

- Drawer open → background chrome `inert` (home, files, studio frames)
- Overlay `inert` when closed
- Files empty preview less sparse (top-biased, max-width)

### Residual (accepted)

- Agent-browser a11y snapshot may still list off-screen drawer nodes; runtime `inert`/`aria-hidden` set correctly
- URL-embedded Basic auth (`http://user:pass@host`) breaks relative `fetch` — browser limitation; use auth dialog or `Authorization` header
- CAD/PCB viewers untouched

## Screenshots

`/tmp/opencode/dogfood-studio/screenshots/`
