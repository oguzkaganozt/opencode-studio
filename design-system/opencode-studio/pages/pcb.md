# Page override — PCB viewer

Overrides MASTER for PCB studio viewer.

## Intent
Project browser + circuit inspection. Mid density tables; cyan accent for MPN/links only. Host shell stays locked.
Mobile: touch tab strip, compact chips, dashed empty wells.

## Surfaces
- Subnav: Projects | Catalog by default; only loaded project detail hides Projects (crumb `← Projects` present). Loading/error keep Projects. No workspace path badge.
- Projects grid: `.pcb-card` + accent rail on hover/focus; health badges; path mono
- Project detail: crumb + health + downloads + diagnostics + view tabs
- Tabs: Schematic · PCB Layout · BOM · 3D · Circuit JSON (`.pcb-tablist` scroll, no scrollbar chrome)
- Active route tabs scroll into view; every tab owns bounded scrolling and has a recoverable error boundary
- Catalog: search + table (min-width scroll) + part modal; filled via BOM **Add to catalog** / `pcb_catalog_upsert` after verified MPN (not empty forever)
- BOM: show **Add to catalog** only when `mpn` is set and `inCatalog` is false; optional bulk for missing catalog rows

## Chrome rules
- Radius via `--osc-radius-*`; no pill CTAs (tags/counts use `radius-sm`)
- Status: success/warning/error tokens + mono compact badges
- Detail readiness uses one neutral status strip; reserve status colors for dots rather than stacked badge fills.
- Project header: crumb + title on the left; readiness + downloads on the same band (wrap on narrow). Hide path when it equals name/id.
- Active tab: accent underline + semibold text
- MPN / datasheet links: `--osc-accent` (PCB cyan)
- Download anchors: `pcb-chip pcb-chip--action` (explicit ink on elevated surface — never bare link color)
- Empty/error: dashed `EmptyState` / `ErrorState` with short recovery copy
- Loading: `.osc-skeleton` + label; honor reduced-motion
- Diagnostics: chevron summary; “Fix with agent” primary chip. Open body capped (`~11.5–14rem` / `26–28dvh`) so the view canvas keeps `min-height: min(22rem, 48dvh)`.
- Selection bar: compact empty hint; only grows when a selection is active
- Warning counts live only in Design diagnostics; do not repeat them in detail readiness.
- Keep routes, SSE stale, agent diagnostics handoff, downloads
- Artifact events refresh project, Circuit JSON, and BOM data together

## Compact
No dual side rails like CAD — agent open is fine; no special collapse required.
Tab labels may truncate horizontally via scroll; hit targets ≥40px on narrow.
Prefer canvas height over chrome: diagnostics expand in-place with scroll, never collapse the schematic/PCB/3D region below the min-height floor.
