# Lock — Shell + Files + CAD + PCB

**Status:** Files + Shell + CAD + **PCB LOCKED** 2026-07-28  
**Do not restyle** without explicit unlock.

Comprehensive UI/UX pass explicitly unlocked by the user and re-locked 2026-07-29. Shared contrast/semantics, Files keyboard + preview flow, CAD inspection status/tooling, PCB tab/data workflows, and mobile targets were re-verified with `bun run check`, browser smoke, and 360/1280 light/dark screenshots.

Settings drawer and Files Agent behavior were explicitly unlocked and overhauled on 2026-07-29.

### Shell lock addendum
| Surface | Paths |
| --- | --- |
| Tokens / global | `ui/tokens.css`, `ui/styles.css` |
| Primitives | `ui/components/*` |
| Shell | `ui/app.tsx`, `ui/native-agent-frame.tsx`, `ui/native-opencode-pane.tsx` |
| Spec | `MASTER.md`, `pages/shell.md` |

Shipped **v0.5.5**. IA update (OpenCode home replaces hub cards; no leave-shell OpenCode chip) — still shell surface.

### CAD lock addendum
| Surface | Paths |
| --- | --- |
| CAD viewer | `studios/cad/viewer/src/app.tsx`, `styles.css` |
| Spec | `pages/cad.md` |

Re-polished **2026-07-29** (toolbar; status pill; empty recovery).  
**Mobile fix 2026-07-29:** sheets outside `inert` (iPhone freeze); phone bottom sheets; lean toolbar.  
**Face pick 2026-07-29:** forge multi-mesh GLB `face_N` + `topo/*.json`; viewer face highlight + pin; structured Prompt. Prior ship **v0.5.6**.

### PCB lock addendum (this pass)
| Surface | Paths |
| --- | --- |
| PCB viewer | `studios/pcb/viewer/src/*` (app, styles, tabs, viewer-frame) |
| Spec | `pages/pcb.md` |

QA: projects list; **built** `wall-sconce-rev-a` schematic/PCB/BOM tabs; diagnostics (108 warnings); catalog empty; mobile project detail + tab strip. 3D/JSON tabs not re-dogfooded this pass.

## Locked surfaces

| Surface | Paths |
| --- | --- |
| Tokens / global | `ui/tokens.css`, `ui/styles.css` |
| Primitives | `ui/components/*` |
| Shell | `ui/app.tsx`, `ui/native-agent-frame.tsx`, `ui/native-opencode-pane.tsx` |
| Files | `ui/files-explorer.tsx` |
| CAD viewer | `studios/cad/viewer/src/app.tsx`, `styles.css` |
| PCB viewer | `studios/pcb/viewer/src/*` |
| Spec | `MASTER.md`, `pages/*.md` |

## Visual QA — PCB polish 2026-07-28

| Check | Result |
| --- | --- |
| Projects desktop | Pass — card, Valid badge, path |
| Schematic + circuit JSON | Pass — interactive schematic |
| PCB layout tab | Pass |
| BOM table | Pass — MPN accent, qty, datasheet |
| Diagnostics panel | Pass — warning counts, Send to agent |
| Mobile projects + project detail | Pass — tab scroll, compact chips |
| Catalog empty | Pass — dashed empty well |
| typecheck / browser-smoke | Pass |

### Fixed this pass

- `.pcb-card` / rail; denser chips; touch tablist; table min-width scroll
- Empty/error wells with recovery copy; catalog empty states
- Workspace badge ≥md; diagnostics chevron; shorter download labels
- ViewerFrame border + token radius; schematic/PCB loading wells

### Residual (accepted)

- Agent open may persist across routes (shell)
- 3D / Circuit JSON tabs not re-dogfooded this pass
- Fab/assembly blocked on fixture (unverified parts / unconnected pins) — content not UI
- Live host may need package release or `dist/ui` sync for polish

## Screenshots

- PCB: `/tmp/opencode/dogfood-pcb/screenshots/`
- CAD: `/tmp/opencode/dogfood-cad/screenshots/`
- Shell: `/tmp/opencode/dogfood-shell/screenshots/`
