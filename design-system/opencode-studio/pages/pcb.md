# Page override — PCB viewer

Overrides MASTER for PCB studio viewer.

## Intent
Project browser + circuit inspection. Mid density tables; cyan accent for MPN/links only. Host shell stays locked.

## Surfaces
- Subnav: Projects | Catalog (uses host `.studio-subnav`)
- Projects grid: elevated cards, health badges, path mono
- Project detail: crumb + health + downloads + diagnostics + view tabs
- Tabs: Schematic · PCB · BOM · 3D · Circuit JSON
- Catalog: search + table + part modal

## Chrome rules
- Radius via `--osc-radius-*`; no pill CTAs
- Status: success/warning/error tokens + mono-ish compact badges
- Active tab: text + border with `--osc-text` (or accent hairline)
- MPN / datasheet links: `--osc-accent` (PCB cyan)
- Loading: skeleton or spinner; honor reduced-motion
- Keep routes, SSE stale, agent diagnostics handoff, downloads

## Compact
No dual side rails like CAD — agent open is fine; no special collapse required.
