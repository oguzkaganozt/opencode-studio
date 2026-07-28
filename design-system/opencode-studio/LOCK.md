# Lock — Shell + Files + CAD + PCB

**Status:** Files + PCB + Shell + **CAD LOCKED** 2026-07-28  
**Do not restyle** without explicit unlock.

### Shell lock addendum
| Surface | Paths |
| --- | --- |
| Tokens / global | `ui/tokens.css`, `ui/styles.css` |
| Primitives | `ui/components/*` |
| Shell | `ui/app.tsx` (TopBar, SideDrawer, Home, Agent actions, frames) |
| Agent chrome | `ui/native-agent-frame.tsx` |
| Spec | `MASTER.md`, `pages/shell.md` |

Shipped in **v0.5.5**.

### CAD lock addendum (this pass)
| Surface | Paths |
| --- | --- |
| CAD viewer | `studios/cad/viewer/src/app.tsx`, `styles.css` |
| Spec | `pages/cad.md` |

QA: empty + **built** `box-lid-demo` (2 parts) desktop/mobile; Designs/Parts sheets; docked rails; toolbar wrap; load/no-build empty wells. Click/copy/prompt path not fully re-dogfooded after geometry load (parts visible, checkboxes OK).

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
| CAD viewer | `studios/cad/viewer/src/app.tsx`, `styles.css` |
| Spec | `MASTER.md`, `pages/shell.md`, `pages/files.md`, `pages/cad.md`, `pages/pcb.md` |

## Visual QA (agent-browser) — CAD polish 2026-07-28

Auth: HTTP Basic via `--headers` JSON. Studio UI: `/studio/`. Content fixture: workspace `designs/box-lid-demo` built via forge.

| Check | Result |
| --- | --- |
| CAD desktop built design | Pass — rails, GLB assembly, parts, status built |
| CAD mobile compact toolbar | Pass — Designs/Parts chips, select `id · status` |
| CAD mobile Designs sheet | Pass — built badge, 2 parts |
| CAD mobile Parts sheet | Pass — box/lid checkboxes |
| typecheck / browser-smoke | Pass |

### Fixed this pass

- `.cad-toolbar` / denser chips; compact select; touch rail/part rows
- Empty wells: loading / no build / load error / no design
- Design options without emoji glyphs (`id · built`)
- Footer mono note hidden on narrow
- Sheet buttons `aria-expanded`; rail `aria-current`

### Residual (accepted)

- Agent open state persists across routes (shell)
- Click→Copy/Prompt not re-exercised in this QA pass after geometry load
- Live host may need `dist/ui` sync until next package release includes CAD polish

## Screenshots

- Shell: `/tmp/opencode/dogfood-shell/screenshots/`
- CAD: `/tmp/opencode/dogfood-cad/screenshots/`
