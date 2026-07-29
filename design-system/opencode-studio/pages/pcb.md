# Page override — PCB viewer

Overrides MASTER for PCB studio viewer.

## Intent
Project browser + circuit inspection. Mid density tables; cyan accent for MPN/links only. Host shell stays locked.
Mobile: touch tab strip, compact chips, dashed empty wells.

## Surfaces
- Subnav: Projects | Catalog (host `.studio-subnav`); workspace path badge ≥md only
- Projects grid: `.pcb-card` + accent rail on hover/focus; health badges; path mono
- Project detail: crumb + health + downloads + diagnostics + view tabs
- Tabs: Schematic · PCB Layout · BOM · 3D · Circuit JSON (`.pcb-tablist` scroll, no scrollbar chrome)
- Catalog: search + table (min-width scroll) + part modal

## Chrome rules
- Radius via `--osc-radius-*`; no pill CTAs
- Status: success/warning/error tokens + mono compact badges
- Detail readiness uses one neutral status strip; reserve status colors for dots rather than stacked badge fills.
- Active tab: accent underline + semibold text
- MPN / datasheet links: `--osc-accent` (PCB cyan)
- Empty/error: dashed `EmptyState` / `ErrorState` with short recovery copy
- Loading: `.pcb-skeleton` + label; honor reduced-motion
- Diagnostics: chevron summary; “Send to agent” chip
- Warning counts live only in Design diagnostics; do not repeat them in detail readiness.
- Keep routes, SSE stale, agent diagnostics handoff, downloads

## Compact
No dual side rails like CAD — agent open is fine; no special collapse required.
Tab labels may truncate horizontally via scroll; hit targets ≥40px on narrow.
