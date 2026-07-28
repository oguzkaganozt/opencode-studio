# Page override — CAD viewer

Overrides MASTER for CAD studio viewer (not host shell).

## Intent
Read-only assembly inspection. Canvas is always dark; chrome is quiet tool UI. CAD amber accent on selection rail / highlight only.
Mobile/compact is first-class (toolbar wrap, sheet rails, larger hit targets).

## Layout
- Root: `flex-1 min-h-0` under host shell (never `h-full` / restyle `.studio-shell`)
- **Wide (main ≥960px, agent closed):** docked Designs rail + canvas + Parts/Renders
- **Compact (agent open OR main <960px):** docked rails hide; canvas full-width; toolbar **Designs** / **Parts** open overlay sheets (`aria-expanded`)
- Host sets `data-agent-open` on `.studio-shell` for CAD to observe
- Footer: 32px meta strip; long mono note hidden &lt;sm

## Canvas chrome
- Solid dark panels (`rgba` black ~0.82–0.88), **no backdrop-blur**
- `.cad-toolbar` + `.cad-chip` / `.cad-select` (compact select on narrow)
- Empty canvas: `.cad-empty` dashed well — distinct copy for no design / no build / load error
- Status: success/warning tokens, not neon
- Click readout: mono + accent/warning tokens (not raw amber Tailwind)
- Design select options: `{id} · {built|stale|unbuilt}` — no emoji status glyphs

## Rails / sheets
- Designs empty + Parts empty use `.cad-rail-empty`
- Rail links: accent rail when `aria-current="page"` / `data-active`
- Part rows: larger touch targets on sheet; checkbox ≥14px

## Keep
- Routes, EventSource, agent handoff, GLB drop/open, fit/reload/copy/prompt
- PART_COLORS for 3D mesh identity
